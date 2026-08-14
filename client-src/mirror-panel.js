// mirror-panel.js — พาเนล mirror หน้าจอ Android แบบฝังในเว็บ (แนว scrcpy)
// สร้าง DOM ของ drawer ด้านขวา, ต่อ WebSocket /api/mirror, ถอดวิดีโอด้วย WebCodecs
// และส่ง input (touch/keyboard/scroll) กลับไปที่ device
//
// Bundle ด้วย esbuild → public/mirror.bundle.js (IIFE) โหลดก่อน app.js
// เปิด global: window.MirrorPanel = { toggle, open, close }

import {
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer,
  BitmapVideoFrameRenderer,
} from '@yume-chan/scrcpy-decoder-webcodecs';
import { ScrcpyVideoCodecId } from '@yume-chan/scrcpy';

// ---------- helper สร้าง element ----------
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp11 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

// map ปุ่มพิเศษ → Android keycode (ตาม contract)
const KEYCODE_MAP = {
  Enter: 66,
  Backspace: 67,
  Delete: 112,
  Tab: 61,
  Escape: 111,
  ArrowLeft: 21,
  ArrowRight: 22,
  ArrowUp: 19,
  ArrowDown: 20,
  ' ': 62, // Space
};

// พารามิเตอร์ start (คงที่ตาม contract)
const START_OPTS = { maxSize: 1024, bitRate: 4000000, maxFps: 30 };
const RECONNECT_DELAY_MS = 3000;

class MirrorPanel {
  constructor() {
    this.ws = null;
    this.decoder = null;
    this.writer = null;
    this.rendererEl = null;
    this.serial = null;
    this.userDisconnected = false; // true = ผู้ใช้กด disconnect เอง → ห้าม auto-reconnect
    this.reconnectTimer = null;
    this.pendingMove = null; // touch move ล่าสุดที่รอส่ง (throttle ด้วย rAF)
    this.moveRaf = 0;
    this.visible = false;
    this._buildDom();
  }

  // ---------- สร้าง DOM ทั้งพาเนล ----------
  _buildDom() {
    // header: เลือก device + refresh + connect/disconnect + status + ซ่อน
    this.deviceSelect = el('select', { class: 'mirror-select', title: 'เลือกอุปกรณ์' });
    this.refreshBtn = el('button', { class: 'mirror-icon-btn', title: 'รีเฟรชรายชื่ออุปกรณ์', text: '⟲' });
    this.connectBtn = el('button', { class: 'mirror-btn primary', text: 'เชื่อมต่อ' });
    this.hideBtn = el('button', { class: 'mirror-icon-btn', title: 'ซ่อนพาเนล (ยังต่ออยู่)', text: '—' });
    this.statusDot = el('span', { class: 'mirror-dot' });
    this.statusText = el('span', { class: 'mirror-status-text', text: 'ยังไม่เชื่อมต่อ' });

    this.refreshBtn.addEventListener('click', () => this.refreshDevices());
    this.connectBtn.addEventListener('click', () => this._onConnectBtn());
    this.hideBtn.addEventListener('click', () => this.hide());

    const header = el('div', { class: 'mirror-header' }, [
      el('div', { class: 'mirror-header-row' }, [
        el('span', { class: 'mirror-title', text: '📱 Mirror' }),
        this.hideBtn,
      ]),
      el('div', { class: 'mirror-header-row' }, [this.deviceSelect, this.refreshBtn]),
      el('div', { class: 'mirror-header-row' }, [
        this.connectBtn,
        el('span', { class: 'mirror-statusline' }, [this.statusDot, this.statusText]),
      ]),
    ]);

    // พื้นที่วิดีโอ — canvas ของ renderer จะถูกแทรกที่นี่
    this.videoArea = el('div', { class: 'mirror-video', tabindex: '0' });
    this.videoPlaceholder = el('div', { class: 'mirror-placeholder', text: 'ยังไม่มีภาพ — กดเชื่อมต่อ' });
    this.videoArea.appendChild(this.videoPlaceholder);
    this._bindInput(this.videoArea);

    // toolbar ปุ่มควบคุม
    const mkTool = (label, title, fn) => {
      const b = el('button', { class: 'mirror-tool', title, text: label });
      b.addEventListener('click', () => fn());
      return b;
    };
    const toolbar = el('div', { class: 'mirror-toolbar' }, [
      mkTool('⬅', 'ย้อนกลับ', () => this.send({ type: 'back' })),
      mkTool('⭘', 'หน้าหลัก', () => this.send({ type: 'home' })),
      mkTool('▢', 'แอปล่าสุด', () => this.send({ type: 'appswitch' })),
      mkTool('🔄', 'หมุนจอ', () => this.send({ type: 'rotate' })),
      mkTool('⏻', 'ปุ่ม power', () => this.send({ type: 'power' })),
      mkTool('⟳', 'ขอ keyframe', () => this.send({ type: 'keyframe' })),
    ]);

    // แถวล่าง: ส่งข้อความ (เส้นทางหลักของภาษาไทย)
    this.textInput = el('input', {
      class: 'mirror-text-input',
      type: 'text',
      placeholder: 'พิมพ์ข้อความส่งเข้าเครื่อง…',
    });
    this.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._sendText(); }
    });
    const sendBtn = el('button', { class: 'mirror-btn', text: 'ส่งข้อความ' });
    sendBtn.addEventListener('click', () => this._sendText());
    const bottomRow = el('div', { class: 'mirror-bottom' }, [this.textInput, sendBtn]);

    this.drawer = el('div', { class: 'mirror-drawer', id: 'mirrorDrawer' }, [
      header,
      this.videoArea,
      toolbar,
      bottomRow,
    ]);
    this.drawer.style.display = 'none';
    document.body.appendChild(this.drawer);
  }

  // ---------- โหลดรายชื่ออุปกรณ์ ----------
  async refreshDevices() {
    try {
      const r = await fetch('/api/devices');
      const j = await r.json();
      const devices = (j && j.devices) || [];
      const prev = this.deviceSelect.value;
      this.deviceSelect.innerHTML = '';
      if (!devices.length) {
        this.deviceSelect.appendChild(el('option', { value: '', text: 'ไม่พบอุปกรณ์' }));
        return;
      }
      for (const d of devices) {
        const label = `${d.model || d.serial}${d.emulator ? ' (emu)' : ''} — ${d.serial}`;
        this.deviceSelect.appendChild(el('option', { value: d.serial, text: label }));
      }
      // คงค่าที่เลือกไว้เดิมถ้ายังมีอยู่
      if (prev && devices.some((d) => d.serial === prev)) this.deviceSelect.value = prev;
    } catch (e) {
      this.deviceSelect.innerHTML = '';
      this.deviceSelect.appendChild(el('option', { value: '', text: 'โหลดอุปกรณ์ไม่ได้' }));
    }
  }

  // ---------- สถานะ ----------
  _setStatus(state, text) {
    // state: idle | connecting | connected | error
    this.statusDot.dataset.state = state;
    this.statusText.textContent = text;
  }

  _setConnected(isConn) {
    this.connectBtn.textContent = isConn ? 'ตัดการเชื่อมต่อ' : 'เชื่อมต่อ';
    this.connectBtn.classList.toggle('danger', isConn);
    this.connectBtn.classList.toggle('primary', !isConn);
  }

  _onConnectBtn() {
    if (this.ws) this.disconnect();
    else this.connect(this.deviceSelect.value);
  }

  // ---------- WebSocket lifecycle ----------
  connect(serial) {
    if (!serial) { this._setStatus('error', 'ยังไม่ได้เลือกอุปกรณ์'); return; }
    if (typeof VideoDecoder === 'undefined') {
      this._setStatus('error', 'เบราว์เซอร์นี้ไม่รองรับ WebCodecs — ใช้ Chrome/Edge');
      return;
    }
    // ตัด session เดิมก่อนเสมอ — เรียก connect/open ซ้ำตอนต่ออยู่ จะได้ไม่ทิ้ง WS เก่า
    // เป็น zombie ฝั่ง server (ปุ่มใน UI toggle ให้อยู่แล้ว แต่ open(serial) เรียกตรงได้)
    if (this.ws) this.disconnect();
    this.serial = serial;
    this.userDisconnected = false;
    this._clearReconnect();
    this._openWs();
  }

  _openWs() {
    this._setStatus('connecting', 'กำลังเชื่อมต่อ…');
    this._setConnected(true);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try {
      ws = new WebSocket(`${proto}//${location.host}/api/mirror`);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.addEventListener('open', () => {
      // start ต้องเป็นข้อความแรกเสมอ
      this.send({ type: 'start', serial: this.serial, ...START_OPTS });
    });
    ws.addEventListener('message', (ev) => this._onMessage(ev));
    ws.addEventListener('error', () => { /* close event จะตามมา จัดการที่ close */ });
    ws.addEventListener('close', () => this._onClose(ws));
  }

  _onClose(ws) {
    if (ws !== this.ws) return; // close ของ ws เก่า (ถูกแทนที่แล้ว) — เมิน
    this.ws = null;
    this._teardownDecoder();
    if (this.userDisconnected) {
      this._setStatus('idle', 'ตัดการเชื่อมต่อแล้ว');
      this._setConnected(false);
      return;
    }
    // ปิดแบบไม่คาดคิด → ลองใหม่เรื่อยๆ จนกว่าจะสำเร็จหรือผู้ใช้สั่งหยุด
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.userDisconnected) return;
    this._setStatus('connecting', 'กำลังเชื่อมต่อใหม่…');
    this._setConnected(true);
    this._clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.userDisconnected) this._openWs();
    }, RECONNECT_DELAY_MS);
  }

  _clearReconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  // disconnect โดยผู้ใช้ — ส่ง stop, ปิด, ไม่ retry
  disconnect() {
    this.userDisconnected = true;
    this._clearReconnect();
    if (this.ws) {
      try { this.send({ type: 'stop' }); } catch (e) { /* ignore */ }
      try { this.ws.close(); } catch (e) { /* ignore */ }
      this.ws = null;
    }
    this._teardownDecoder();
    this._setStatus('idle', 'ตัดการเชื่อมต่อแล้ว');
    this._setConnected(false);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  // ---------- รับ message จาก server ----------
  _onMessage(ev) {
    if (typeof ev.data === 'string') {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      this._onControl(msg);
    } else {
      // binary → payload วิดีโอ
      this._onBinary(ev.data);
    }
  }

  _onControl(msg) {
    switch (msg && msg.type) {
      case 'ready':
        this._setupDecoder(msg);
        this._setStatus('connected', 'เชื่อมต่อแล้ว');
        this._setConnected(true);
        this.videoPlaceholder.style.display = 'none';
        break;
      case 'meta':
        // หมุน/รีไซส์ → ปรับ aspect ของ canvas
        if (this.rendererEl && msg.width && msg.height) {
          this.rendererEl.style.aspectRatio = `${msg.width} / ${msg.height}`;
        }
        break;
      case 'error':
        this._setStatus('error', msg.message || 'เกิดข้อผิดพลาด');
        // server จะปิด WS ตามมา — close handler ตัดสินใจ retry เอง
        break;
      case 'stopped':
        // server หยุดสตรีม
        this._setStatus('idle', 'สตรีมหยุด' + (msg.reason ? ` — ${msg.reason}` : ''));
        break;
      default:
        break;
    }
  }

  // ---------- decoder / renderer ----------
  _setupDecoder(ready) {
    this._teardownDecoder();
    // เลือก renderer แบบ canvas: WebGL ก่อน (เร็วกว่า) ถ้าไม่รองรับใช้ Bitmap (compat สูงสุด)
    let renderer;
    try {
      if (WebGLVideoFrameRenderer && WebGLVideoFrameRenderer.isSupported) {
        renderer = new WebGLVideoFrameRenderer();
      } else {
        renderer = new BitmapVideoFrameRenderer();
      }
    } catch (e) {
      renderer = new BitmapVideoFrameRenderer();
    }

    // ใช้ codec ตามที่ server บอกใน ready (วันนี้ default h264 แต่กันเคสเครื่องส่ง h265/av1)
    const codecId = ready && ready.codec === 'h265' ? ScrcpyVideoCodecId.H265
      : ready && ready.codec === 'av1' ? ScrcpyVideoCodecId.AV1
      : ScrcpyVideoCodecId.H264;
    let decoder;
    try {
      decoder = new WebCodecsVideoDecoder({ codec: codecId, renderer });
    } catch (e) {
      this._setStatus('error', 'สร้างตัวถอดวิดีโอไม่ได้');
      return;
    }
    this.decoder = decoder;
    this.writer = decoder.writable.getWriter();

    // แทรก canvas ของ renderer เข้าพื้นที่วิดีโอ
    const canvas = renderer.canvas;
    canvas.classList.add('mirror-canvas');
    this.rendererEl = canvas;
    if (ready && ready.width && ready.height) {
      canvas.style.aspectRatio = `${ready.width} / ${ready.height}`;
    }
    this.videoArea.appendChild(canvas);
  }

  _teardownDecoder() {
    if (this.writer) {
      try { this.writer.releaseLock(); } catch (e) { /* ignore */ }
      this.writer = null;
    }
    if (this.decoder) {
      try { this.decoder.dispose(); } catch (e) { /* ignore */ }
      this.decoder = null;
    }
    if (this.rendererEl && this.rendererEl.parentNode) {
      this.rendererEl.parentNode.removeChild(this.rendererEl);
    }
    this.rendererEl = null;
    if (this.videoPlaceholder) this.videoPlaceholder.style.display = '';
  }

  _onBinary(buf) {
    if (!this.writer) return;
    let packet;
    try {
      const dv = new DataView(buf);
      const kind = dv.getUint8(0);
      const ptsFloat = dv.getFloat64(4, true); // pts ไมโครวินาที, Float64 LE
      const payload = new Uint8Array(buf, 12);
      if (kind === 0) {
        packet = { type: 'configuration', data: payload };
      } else {
        packet = { type: 'data', keyframe: kind === 1, pts: BigInt(Math.round(ptsFloat)), data: payload };
      }
    } catch (e) {
      return;
    }
    // ป้อนเข้า writable stream ของ decoder (ไม่ await เพื่อไม่บล็อกลูป rendering)
    this.writer.write(packet).catch(() => {
      // decoder error → ปล่อยให้ close/reconnect จัดการ
    });
  }

  // ---------- input capture บนพื้นที่วิดีโอ ----------
  _bindInput(container) {
    // normalize จุดจาก event → 0..1 เทียบกรอบ canvas (ถ้ายังไม่มี canvas ใช้กรอบ container)
    const norm = (e) => {
      const target = this.rendererEl || container;
      const r = target.getBoundingClientRect();
      const x = r.width ? (e.clientX - r.left) / r.width : 0;
      const y = r.height ? (e.clientY - r.top) / r.height : 0;
      return { x: clamp01(x), y: clamp01(y) };
    };

    container.addEventListener('pointerdown', (e) => {
      if (!this.ws) return;
      container.focus();
      try { container.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const { x, y } = norm(e);
      this.send({ type: 'touch', action: 'down', pointerId: e.pointerId, x, y, pressure: e.pressure || 1 });
      e.preventDefault();
    });

    container.addEventListener('pointermove', (e) => {
      if (!this.ws) return;
      if (e.buttons === 0 && e.pointerType === 'mouse') return; // ไม่กด = ไม่ลาก
      const { x, y } = norm(e);
      // throttle: เก็บตำแหน่งล่าสุด ส่งเฟรมละครั้งด้วย rAF
      this.pendingMove = { pointerId: e.pointerId, x, y, pressure: e.pressure || 1 };
      if (!this.moveRaf) {
        this.moveRaf = requestAnimationFrame(() => {
          this.moveRaf = 0;
          const m = this.pendingMove;
          this.pendingMove = null;
          if (m) this.send({ type: 'touch', action: 'move', ...m });
        });
      }
    });

    const up = (e) => {
      if (!this.ws) return;
      try { container.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      // ล้าง move ที่ค้าง เพื่อไม่ให้ move มาหลัง up
      if (this.moveRaf) { cancelAnimationFrame(this.moveRaf); this.moveRaf = 0; }
      this.pendingMove = null;
      const { x, y } = norm(e);
      this.send({ type: 'touch', action: 'up', pointerId: e.pointerId, x, y, pressure: 0 });
    };
    container.addEventListener('pointerup', up);
    container.addEventListener('pointercancel', up);

    // scroll → wheel
    container.addEventListener('wheel', (e) => {
      if (!this.ws) return;
      e.preventDefault();
      const { x, y } = norm(e);
      this.send({
        type: 'scroll',
        x, y,
        hDelta: clamp11(-e.deltaX / 100),
        vDelta: clamp11(-e.deltaY / 100),
      });
    }, { passive: false });

    // keyboard: ปุ่มพิเศษ → key, ตัวอักษรพิมพ์ได้ → text
    container.addEventListener('keydown', (e) => {
      if (!this.ws) return;
      if (e.key in KEYCODE_MAP) {
        this.send({ type: 'key', action: 'down', keycode: KEYCODE_MAP[e.key], metaState: 0 });
        e.preventDefault();
        return;
      }
      // ตัวอักษรเดี่ยวที่พิมพ์ได้ (ไม่กด ctrl/meta) → รวมเป็นก้อนก่อนส่ง (debounce 150ms)
      // ห้ามส่งทีละตัว: ฝั่ง server ใช้ clipboard paste ต่อ 1 ข้อความ ถ้ายิงถี่ๆ
      // paste จะ race กันเองบนเครื่อง ตัวอักษรหาย/ซ้ำ (เจอจริงตอน E2E: "wifi" กลายเป็น "wii")
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this._typeBuffer = (this._typeBuffer || '') + e.key;
        clearTimeout(this._typeTimer);
        this._typeTimer = setTimeout(() => {
          const text = this._typeBuffer;
          this._typeBuffer = '';
          if (text) this.send({ type: 'text', text });
        }, 150);
        e.preventDefault();
      }
    });
    container.addEventListener('keyup', (e) => {
      if (!this.ws) return;
      if (e.key in KEYCODE_MAP) {
        this.send({ type: 'key', action: 'up', keycode: KEYCODE_MAP[e.key], metaState: 0 });
        e.preventDefault();
      }
    });

    container.addEventListener('click', () => container.focus());
  }

  _sendText() {
    const text = this.textInput.value;
    if (!text) return;
    this.send({ type: 'text', text });
    this.textInput.value = '';
  }

  // ---------- แสดง/ซ่อนพาเนล ----------
  show() {
    this.drawer.style.display = 'flex';
    document.body.classList.add('mirror-open');
    this.visible = true;
    // โหลดรายชื่ออุปกรณ์ครั้งแรกเมื่อยังว่าง
    if (!this.deviceSelect.options.length) this.refreshDevices();
  }

  hide() {
    // ซ่อนอย่างเดียว — WS + decoder ยังทำงานต่อ
    this.drawer.style.display = 'none';
    document.body.classList.remove('mirror-open');
    this.visible = false;
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  open(serial) {
    this.show();
    if (serial) {
      // เลือก serial แล้วต่อทันที (เติมรายชื่อก่อนถ้ายังไม่มี option นี้)
      const doConnect = () => {
        if (![...this.deviceSelect.options].some((o) => o.value === serial)) {
          this.deviceSelect.appendChild(el('option', { value: serial, text: serial }));
        }
        this.deviceSelect.value = serial;
        this.connect(serial);
      };
      if (!this.deviceSelect.options.length) this.refreshDevices().then(doConnect);
      else doConnect();
    }
  }

  close() {
    // ตัดการเชื่อมต่อเต็มรูปแบบ + ซ่อน
    this.disconnect();
    this.hide();
  }
}

// สร้าง singleton + expose global
const panel = new MirrorPanel();
window.MirrorPanel = {
  toggle: () => panel.toggle(),
  open: (serial) => panel.open(serial),
  close: () => panel.close(),
};
