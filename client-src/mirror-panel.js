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
// Android (scrcpy): 60 fps ลื่นกว่าชัดเจน · bitrate ขึ้นตามเพื่อไม่ให้ภาพแตกเวลาเลื่อนเร็ว
// (maxSize 1024 พอสำหรับพาเนลกว้างสุด 900px — ใหญ่กว่านี้เสีย decode ฟรี)
const START_OPTS = { maxSize: 1024, bitRate: 8000000, maxFps: 60 };
// iOS Simulator (ลูป screenshot) — ตัวเลขที่วัดมาจริงบนเครื่องนี้ (scripts/dev-tests/mirror-fps-bench.js):
//   ต้นทุนต่อเฟรม `simctl io screenshot` = 218ms แต่ `simctl help` ที่ไม่ทำอะไรเลยกิน 170ms
//   → 78% เป็นค่าเกิด process ล้วนๆ ไม่ใช่การถ่ายภาพ ต่อสายละ ~4.6 fps เป็นเพดาน
//   ทางเดียวที่เร็วขึ้นคือถ่ายพร้อมกันหลายสาย (pipeline) · 4 สายกำลังพอดีกับ CPU
//   ย่อฝั่ง server (maxWidth) ปิดไว้ — sips กินเวลามากกว่าที่ประหยัดได้ 2-3 เท่า
//   (แต่ยังเปิดได้ถ้าเน็ตช้า/ต่อไกล เพราะเฟรมเล็กลง ~10 เท่า)
const IOS_START_OPTS = { pipeline: 4, maxWidth: 0 };
const RECONNECT_DELAY_MS = 3000;

class MirrorPanel {
  constructor() {
    this.ws = null;
    this.decoder = null;
    this.writer = null;
    this.rendererEl = null;
    this.serial = null;
    this.platform = 'android'; // 'android' (scrcpy) | 'ios' (simulator: ลูป JPEG + idb)
    this.iosCanvas = null;     // canvas สำหรับวาดเฟรม JPEG ของ iOS
    this.iosCtx = null;
    this.deviceWarn = '';      // ข้อความเตือนตอนโหลดรายชื่ออุปกรณ์ได้ไม่ครบ
    this._note = null;         // ข้อความเตือนที่คาอยู่บนแถบสถานะ
    this.iosBusy = false;      // กำลัง decode เฟรมอยู่
    this.iosPending = null;    // เฟรมล่าสุดที่รอ decode (เก่ากว่านั้นทิ้งได้ ไม่ต้องวาดย้อนหลัง)
    this.iosInput = false;     // มี idb ไหม (ไม่มี = ดูได้อย่างเดียว)
    this.fpsCount = 0;
    this.fps = 0;
    this._fpsTimer = null;
    this.userDisconnected = false; // true = ผู้ใช้กด disconnect เอง → ห้าม auto-reconnect
    this.reconnectTimer = null;
    this.pendingMove = null; // touch move ล่าสุดที่รอส่ง (throttle ด้วย rAF)
    this.moveRaf = 0;
    this.visible = false;
    this._buildDom();
  }

  // ---------- สร้าง DOM ทั้งพาเนล ----------
  // โครงแบบ Android Studio: icon rail แนวตั้งชิดขวาสุด + tool window 2 อัน
  // (🗂️ Device Manager = รายการอุปกรณ์ / 📱 Running Devices = จอที่กำลัง mirror)
  // กด icon เปิด/ปิด panel ของตัวเอง · กด ▶ ใน Device Manager จะสลับไป Running Devices เอง
  _buildDom() {
    // --- rail มุมขวา ---
    this.railRunningBtn = el('button', {
      class: 'mirror-rail-btn', id: 'mirrorRailRunning', title: 'Running Devices — จอที่กำลัง mirror', text: '📱',
    });
    this.railDevicesBtn = el('button', {
      class: 'mirror-rail-btn', id: 'mirrorRailDevices', title: 'Device Manager — อุปกรณ์ที่ online', text: '🗂️',
    });
    this.railRunningBtn.addEventListener('click', () => this.togglePanel('running'));
    this.railDevicesBtn.addEventListener('click', () => this.togglePanel('devices'));
    // ลำดับ icon: Device Manager อยู่บน, Running Devices อยู่ล่าง (ตามที่เจ้านายสั่ง)
    const rail = el('div', { class: 'mirror-rail' }, [this.railDevicesBtn, this.railRunningBtn]);

    // --- view: Device Manager ---
    this.refreshBtn = el('button', { class: 'mirror-icon-btn', title: 'รีเฟรชรายชื่ออุปกรณ์', text: '⟲' });
    this.refreshBtn.addEventListener('click', () => this.refreshDevices());
    this.deviceList = el('div', { class: 'mirror-device-list' });
    this.devices = [];
    this.devicesView = el('div', { class: 'mirror-view' }, [
      el('div', { class: 'mirror-header-row' }, [
        el('span', { class: 'mirror-title', text: '🗂️ Device Manager' }),
        this.refreshBtn,
      ]),
      this.deviceList,
    ]);

    // --- view: Running Devices (สถานะ + วิดีโอ + ควบคุม) ---
    this.statusDot = el('span', { class: 'mirror-dot' });
    this.statusText = el('span', { class: 'mirror-status-text', text: 'ยังไม่เชื่อมต่อ' });
    const runningHeader = el('div', { class: 'mirror-header-row' }, [
      el('span', { class: 'mirror-title', text: '📱 Running Devices' }),
      el('span', { class: 'mirror-statusline' }, [this.statusDot, this.statusText]),
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
    // [ปุ่ม, ใช้ได้บน iOS ไหม] — iOS มีแค่ Home/Lock/Siri ที่ idb สั่งได้
    // (ปุ่ม back/แอปล่าสุด/หมุนจอ/keyframe เป็นของ Android → ซ่อนตอน mirror iOS)
    // ระบุ platform ที่ปุ่มใช้ได้ตรง ๆ ไม่ใช้ index (เดิมเป็น toolButtons[5][0] — สลับลำดับปุ่มแล้วซ่อนผิดตัวเงียบ ๆ)
    this.toolButtons = [
      { btn: mkTool('⬅', 'ย้อนกลับ', () => this.send({ type: 'back' })), on: ['android'] },
      { btn: mkTool('⭘', 'หน้าหลัก', () => this.send({ type: 'home' })), on: ['android', 'ios'] },
      { btn: mkTool('▢', 'แอปล่าสุด', () => this.send({ type: 'appswitch' })), on: ['android'] },
      { btn: mkTool('🔄', 'หมุนจอ', () => this.send({ type: 'rotate' })), on: ['android'] },
      { btn: mkTool('⏻', 'ปุ่ม power / ล็อกจอ', () => this.send({ type: 'power' })), on: ['android', 'ios'] },
      { btn: mkTool('🎙', 'Siri', () => this.send({ type: 'siri' })), on: ['ios'] },
      { btn: mkTool('⟳', 'ขอ keyframe', () => this.send({ type: 'keyframe' })), on: ['android'] },
    ];
    const toolbar = el('div', { class: 'mirror-toolbar' }, this.toolButtons.map((t) => t.btn));

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

    this.runningView = el('div', { class: 'mirror-view' }, [
      runningHeader,
      this.videoArea,
      toolbar,
      bottomRow,
    ]);

    // ตัวจับลากขยายความกว้าง panel (ขอบซ้ายของ drawer) — เหมือนแผง URL/Devices ฝั่งซ้าย
    this.resizer = el('div', { class: 'mirror-resizer', title: 'ลากเพื่อปรับความกว้าง' });
    this._bindResizer();

    // สอง tool window แยกกันชัดเจน (กด icon ไหนเห็นเฉพาะ view นั้น — ไม่เอาแบบซ้อนในแผงเดียว)
    this.drawer = el('div', { class: 'mirror-drawer', id: 'mirrorDrawer' }, [
      this.resizer,
      this.devicesView,
      this.runningView,
    ]);
    this._applyPlatformUi(); // ซ่อนปุ่มเฉพาะ iOS ไว้ก่อน (ค่าเริ่มต้นคือ android)
    this.drawer.style.display = 'none';
    this.activeView = null; // view ล่าสุดที่ผู้ใช้กดจาก rail (ใช้ตัดสิน toggle ปิด)
    // คืนค่าความกว้างที่ผู้ใช้เคยลากไว้
    const savedW = Number(localStorage.getItem('mirrorPanelW'));
    if (savedW >= 300 && savedW <= 900) {
      document.documentElement.style.setProperty('--mirror-w', `${savedW}px`);
    }
    document.body.appendChild(rail);
    document.body.appendChild(this.drawer);
    // เผื่อพื้นที่ให้ rail เสมอ (padding-right ใน CSS)
    // ชื่อ class บน body ต้องไม่ซ้ำกับ .mirror-rail ของตัว rail — เคยพลาดแล้ว CSS จับ body
    // กลายเป็นกล่อง fixed 44px ทั้งหน้า (layout พังยับ)
    document.body.classList.add('has-mirror-rail');
  }

  // ---------- โหลดรายชื่ออุปกรณ์ (Device Manager style) ----------
  async refreshDevices() {
    // Android (adb) กับ iOS Simulator (simctl) มาคนละ endpoint — ดึงคู่กันแล้วรวมเป็นรายการเดียว
    const [aRes, iRes] = await Promise.allSettled([
      fetch('/api/devices').then((r) => r.json()),
      fetch('/api/devices/ios-sims').then((r) => r.json()),
    ]);
    if (aRes.status === 'rejected' && iRes.status === 'rejected') {
      this.devices = null; // โหลดไม่ได้ทั้งคู่
      this._renderDevices();
      return;
    }
    const list = [];
    const aj = aRes.status === 'fulfilled' ? aRes.value : null;
    for (const d of (aj && aj.devices) || []) {
      list.push({
        id: d.serial,
        platform: 'android',
        name: `${d.model || d.serial}${d.emulator ? ' (emulator)' : ''}`,
        sub: `${d.serial} · ${d.transport || d.mode || ''}${d.connected ? ' · proxy ✓' : ''}`,
      });
    }
    const ij = iRes.status === 'fulfilled' ? iRes.value : null;
    const iosProxyOn = Boolean(ij && ij.proxy && ij.proxy.active);
    for (const sim of (ij && ij.sims) || []) {
      list.push({
        id: sim.udid,
        platform: 'ios',
        name: `🍎 ${sim.name}`,
        sub: `${sim.runtime || 'iOS'} · simulator${iosProxyOn ? ' · proxy ✓' : ''}`,
      });
    }
    // ฝั่งใดฝั่งหนึ่งพลาด → ยังโชว์ที่เหลือได้ แต่ต้องบอกด้วย ไม่งั้นดูเหมือน "เครื่องหาย"
    // (เจอจริงตอนวัด perf: /api/devices ตอบช้าไปรอบเดียว รายการขึ้นแค่ sim แล้วงงว่ามือถือหายไปไหน)
    this.deviceWarn = aRes.status === 'rejected' ? 'โหลดรายชื่อ Android (adb) ไม่ได้'
      : iRes.status === 'rejected' ? 'โหลดรายชื่อ iOS Simulator (simctl) ไม่ได้' : '';
    this.devices = list;
    this._renderDevices();
  }

  _renderDevices() {
    this.deviceList.innerHTML = '';
    if (this.devices === null) {
      this.deviceList.appendChild(el('div', { class: 'mirror-device-empty', text: 'โหลดรายชื่ออุปกรณ์ไม่ได้' }));
      return;
    }
    if (!this.devices.length) {
      this.deviceList.appendChild(el('div', {
        class: 'mirror-device-empty',
        text: this.deviceWarn ? `ไม่พบอุปกรณ์ — ${this.deviceWarn}` : 'ไม่พบอุปกรณ์ที่ online',
      }));
      return;
    }
    if (this.deviceWarn) {
      this.deviceList.appendChild(el('div', { class: 'mirror-device-empty', text: `⚠️ ${this.deviceWarn}` }));
    }
    for (const d of this.devices) {
      const isActive = Boolean(this.ws) && this.serial === d.id;
      const dot = el('span', { class: 'mirror-device-dot' });
      const name = el('div', { class: 'mirror-device-name', text: d.name });
      const sub = el('div', { class: 'mirror-device-sub', text: d.sub });
      const btn = el('button', {
        class: 'mirror-btn ' + (isActive ? 'danger' : 'primary'),
        text: isActive ? '⏹ หยุด' : '▶ ดูจอ',
        title: isActive ? 'หยุด mirror เครื่องนี้' : 'เปิด mirror เครื่องนี้ (ตั้ง proxy ให้ด้วย)',
      });
      btn.addEventListener('click', () => {
        if (isActive) { this.disconnect(); return; }
        this.connect(d.id, d.platform);
        this.showPanel('running'); // เริ่ม mirror แล้วสลับไป Running Devices (rail highlight ตาม)
      });
      // ใส่ id/platform ไว้บนแถว — เดิมเทสต์ต้องแกะจากข้อความ sub ซึ่งของ Android เป็น serial
      // แต่ของ iOS เป็น runtime ("iOS-26-5") → แกะได้ udid ผิด แล้วคำสั่ง simctl ทั้งชุดเงียบหาย
      const row = el('div', {
        class: 'mirror-device-row' + (isActive ? ' active' : ''),
        'data-device-id': d.id,
        'data-platform': d.platform,
      }, [
        dot,
        el('div', { class: 'mirror-device-info' }, [name, sub]),
        btn,
      ]);
      this.deviceList.appendChild(row);
    }
  }

  // ---------- สถานะ ----------
  _setStatus(state, text) {
    // state: idle | connecting | connected | error
    this.statusDot.dataset.state = state;
    this.statusText.textContent = text;
  }

  _setConnected(isConn) {
    // สถานะ active เปลี่ยน → วาดรายการอุปกรณ์ใหม่ (ปุ่มต่อแถวจะสลับ ▶/⏹ เอง)
    void isConn;
    this._renderDevices();
  }

  // ---------- WebSocket lifecycle ----------
  connect(serial, platform = 'android') {
    if (!serial) { this._setStatus('error', 'ยังไม่ได้เลือกอุปกรณ์'); return; }
    // iOS ส่งมาเป็น JPEG ทีละเฟรม ไม่ต้องใช้ WebCodecs (เช็คเฉพาะทาง scrcpy)
    if (platform !== 'ios' && typeof VideoDecoder === 'undefined') {
      this._setStatus('error', 'เบราว์เซอร์นี้ไม่รองรับ WebCodecs — ใช้ Chrome/Edge');
      return;
    }
    this.platform = platform;
    this._applyPlatformUi();
    this._setNote('');
    // ตัด session เดิมก่อนเสมอ — เรียก connect/open ซ้ำตอนต่ออยู่ จะได้ไม่ทิ้ง WS เก่า
    // เป็น zombie ฝั่ง server (ปุ่มใน UI toggle ให้อยู่แล้ว แต่ open(serial) เรียกตรงได้)
    if (this.ws) this.disconnect();
    this.serial = serial;
    this.userDisconnected = false;
    this._proxyEnsured = false; // ตั้ง proxy ให้เครื่องหนึ่งครั้งต่อการกดเชื่อมต่อ (ไม่ยิงซ้ำทุก auto-reconnect)
    this._clearReconnect();
    this._openWs();
  }

  // ตั้ง proxy ให้เครื่องอัตโนมัติ (endpoint เดียวกับปุ่ม connect ในแท็บ Status) — best effort
  // หมายเหตุ: เรียกครั้งเดียวต่อการกดเชื่อมต่อ เพราะบน emulator ที่ CA ยังไม่มี endpoint นี้
  // จะติดตั้ง CA (restart framework ~90s) — ห้ามยิงรัวทุกรอบ auto-reconnect
  async _ensureDeviceProxy() {
    if (this._proxyEnsured) return;
    this._proxyEnsured = true;
    try {
      const r = this.platform === 'ios'
        ? await fetch('/api/devices/ios-sim/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ udid: this.serial }),
        })
        : await fetch('/api/devices/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serial: this.serial }),
        });
      const j = await r.json().catch(() => null);
      // ตั้ง proxy ไม่สำเร็จ = ดูจอได้แต่ traffic ไม่เข้า → คาไว้ไม่ให้หมดอายุ ผู้ใช้ต้องเห็น
      if (!j || j.ok === false) this._setNote('ตั้ง proxy ไม่สำเร็จ — traffic จะไม่เข้า', 0);
    } catch (e) {
      this._setNote('ตั้ง proxy ไม่สำเร็จ — traffic จะไม่เข้า', 0);
    }
    this.refreshDevices(); // อัปเดต badge "proxy ✓" ในรายการ
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
      if (this.platform === 'ios') this.send({ type: 'start', platform: 'ios', udid: this.serial, ...IOS_START_OPTS });
      else this.send({ type: 'start', serial: this.serial, ...START_OPTS });
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
        if (msg.platform === 'ios') this._setupIosView(msg);
        else this._setupDecoder(msg);
        this._setStatus('connected', 'เชื่อมต่อแล้ว');
        this._startFpsTimer();
        this._setConnected(true);
        this.videoPlaceholder.style.display = 'none';
        this._ensureDeviceProxy(); // ตั้ง proxy ให้เครื่องอัตโนมัติ (ครั้งเดียวต่อการกดเชื่อมต่อ)
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
      case 'ios-warn':
        // idb สั่งงานไม่สำเร็จ — คาไว้ 15 วิ แล้วหายเอง (ไม่ตัดสตรีม)
        this._setNote(msg.message || 'สั่งงานไม่สำเร็จ');
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

  // ---------- iOS: รับ JPEG ทีละเฟรมมาวาดลง canvas ----------
  _setupIosView(ready) {
    this._teardownDecoder();
    const canvas = el('canvas', { class: 'mirror-canvas' });
    canvas.width = ready.width || 390;
    canvas.height = ready.height || 844;
    canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
    this.iosCanvas = canvas;
    this.iosCtx = canvas.getContext('2d');
    this.rendererEl = canvas;
    this.iosInput = Boolean(ready.input);
    this.videoArea.appendChild(canvas);
    this._applyPlatformUi();
    if (!this.iosInput) {
      this._setStatus('connected', 'ดูภาพได้ · สั่งงานไม่ได้ (ยังไม่ได้ติดตั้ง idb)');
    }
  }

  // เก็บเฟรมล่าสุดไว้เสมอ แล้วค่อย decode ทีละเฟรม — "เอาอันใหม่สุด" ไม่ใช่ "เอาอันแรกแล้วทิ้งที่เหลือ"
  // (ถ้าทิ้งแบบหลัง เวลาเฟรมมาติดกันเป็นชุด จะวาดได้แค่ชุดละเฟรมเดียว)
  _onIosFrame(buf) {
    this.iosPending = buf;
    if (!this.iosBusy) this._drainIosFrame();
  }

  _drainIosFrame() {
    const buf = this.iosPending;
    this.iosPending = null;
    if (!buf || !this.iosCtx) return;
    this.iosBusy = true;
    createImageBitmap(new Blob([buf], { type: 'image/jpeg' })).then((bmp) => {
      this.iosBusy = false;
      if (!this.iosCtx || !this.iosCanvas) { bmp.close(); return; }
      if (this.iosCanvas.width !== bmp.width || this.iosCanvas.height !== bmp.height) {
        this.iosCanvas.width = bmp.width;
        this.iosCanvas.height = bmp.height;
        this.iosCanvas.style.aspectRatio = `${bmp.width} / ${bmp.height}`;
      }
      this.iosCtx.drawImage(bmp, 0, 0);
      bmp.close();
      this._tickFps();
      if (this.iosPending) this._drainIosFrame(); // มีเฟรมใหม่รออยู่ ต่อเลย
    }).catch(() => {
      this.iosBusy = false;
      if (this.iosPending) this._drainIosFrame(); // เฟรมเสียใบเดียวไม่ควรทำสตรีมค้าง
    });
  }

  // นับเฟรมที่วาดได้ — แค่บวกตัวนับ ส่วนการโชว์ให้ตัวจับเวลาเป็นคนทำ
  _tickFps() { this.fpsCount++; }

  // อัปเดตแถบสถานะทุกวินาทีด้วยนาฬิกา ไม่ใช่รอเฟรมถัดไป
  // (ฝั่ง iOS ข้ามเฟรมที่ซ้ำ → จอนิ่งแล้วไม่มีเฟรมเข้ามาเลย ถ้าผูกกับเฟรมตัวเลขจะค้าง
  //  และข้อความอื่นที่เขียนทับไว้ เช่น "ตั้ง proxy ไม่สำเร็จ" จะค้างถาวร)
  _startFpsTimer() {
    this._stopFpsTimer();
    this.fpsCount = 0;
    this._fpsTimer = setInterval(() => {
      if (!this.ws) return;
      this.fps = this.fpsCount;
      this.fpsCount = 0;
      const viewOnly = this.platform === 'ios' && !this.iosInput ? ' · ดูอย่างเดียว' : '';
      const idle = this.fps === 0 ? ' (จอนิ่ง)' : '';
      this._setStatus('connected', `เชื่อมต่อแล้ว · ${this.fps} fps${idle}${viewOnly}${this._noteText()}`);
    }, 1000);
  }

  // ข้อความเตือนที่ต้อง "คา" อยู่กับแถบสถานะ — ไม่งั้นตัวเลข fps (เขียนทับทุกวินาที)
  // จะกลบมันหายใน 1 วิ เช่น "ตั้ง proxy ไม่สำเร็จ" หรือ error จาก idb ที่ผู้ใช้ต้องเห็น
  // ms = 0 คือคาไว้ตลอดจนกว่าจะต่อใหม่
  _setNote(text, ms = 15000) {
    this._note = text ? { text, until: ms ? Date.now() + ms : Infinity } : null;
  }

  _noteText() {
    if (!this._note) return '';
    if (Date.now() > this._note.until) { this._note = null; return ''; }
    return ' · ⚠️ ' + this._note.text;
  }

  _stopFpsTimer() {
    if (this._fpsTimer) { clearInterval(this._fpsTimer); this._fpsTimer = null; }
  }

  // ปุ่มบน toolbar ที่ใช้ได้ต่างกันระหว่าง Android กับ iOS
  _applyPlatformUi() {
    for (const t of this.toolButtons || []) {
      t.btn.style.display = t.on.includes(this.platform) ? '' : 'none';
    }
  }

  _teardownDecoder() {
    this._stopFpsTimer();
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
    this.iosCanvas = null;
    this.iosCtx = null;
    this.iosBusy = false;
    this.iosPending = null;
    this.fpsCount = 0;
    if (this.videoPlaceholder) this.videoPlaceholder.style.display = '';
  }

  _onBinary(buf) {
    if (this.platform === 'ios') { this._onIosFrame(buf); return; }
    if (!this.writer) return;
    this._tickFps(); // นับเฟรมวิดีโอที่เข้า decoder (Android) — โชว์ที่แถบสถานะเหมือนฝั่ง iOS
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

  // ---------- แสดง/ซ่อน tool window (แบบ Android Studio) ----------
  // เปิด = dock ด้านขวาข้าง rail ดันเนื้อหาหลัก (body.mirror-open ใน CSS) ไม่ทับจอ
  // แต่ละ icon มี view ของตัวเอง แยกกันชัดเจน: 🗂️ = รายการอุปกรณ์ / 📱 = จอ mirror
  // ปิด = กด icon เดิมซ้ำ · session mirror ยังทำงานต่อเสมอ (ปิดแค่หน้าต่าง)
  showPanel(view) {
    this.activeView = view;
    this.drawer.style.display = 'flex';
    this.devicesView.style.display = view === 'devices' ? 'flex' : 'none';
    this.runningView.style.display = view === 'running' ? 'flex' : 'none';
    this.railDevicesBtn.classList.toggle('active', view === 'devices');
    this.railRunningBtn.classList.toggle('active', view === 'running');
    document.body.classList.add('mirror-open');
    this.visible = true;
    this.refreshDevices();
    // รีเฟรชรายการอุปกรณ์เป็นระยะ — เฉพาะตอนที่ "เห็นรายการอยู่จริง"
    // (/api/devices ยิง adb, /api/devices/ios-sims ยิง simctl — spawn process ทุกรอบ
    //  ถ้า poll ทิ้งไว้ตอนดูจอ ภาพจะสะดุดเป็นจังหวะ ๆ ทั้ง Android และ iOS)
    this._syncDeviceTimer(view);
  }

  // เปิด/ปิด timer ตาม view ที่กำลังแสดง
  _syncDeviceTimer(view) {
    const want = view === 'devices';
    if (want && !this._deviceTimer) {
      this._deviceTimer = setInterval(() => this.refreshDevices(), 5000);
    } else if (!want && this._deviceTimer) {
      clearInterval(this._deviceTimer);
      this._deviceTimer = null;
    }
  }

  closePanel() {
    this.activeView = null;
    this.drawer.style.display = 'none';
    this.railDevicesBtn.classList.remove('active');
    this.railRunningBtn.classList.remove('active');
    document.body.classList.remove('mirror-open');
    this.visible = false;
    if (this._deviceTimer) { clearInterval(this._deviceTimer); this._deviceTimer = null; }
  }

  togglePanel(view) {
    // กด icon ของ view ที่เปิดอยู่ = ปิด · กด icon อีกอัน = สลับ view (พฤติกรรม tool window ของ AS)
    if (this.activeView === view) this.closePanel();
    else this.showPanel(view);
  }

  // ---------- ลากขยายความกว้าง panel ----------
  _bindResizer() {
    let dragging = false;
    this.resizer.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.resizer.setPointerCapture(e.pointerId);
      document.body.style.userSelect = 'none'; // กันลากแล้วไป select ข้อความ
      e.preventDefault();
    });
    this.resizer.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      // ความกว้าง = ระยะจากเมาส์ถึงขอบซ้ายของ rail (rail กว้าง 44px ชิดขวาสุด)
      const w = Math.min(900, Math.max(300, window.innerWidth - 44 - e.clientX));
      document.documentElement.style.setProperty('--mirror-w', `${w}px`);
    });
    const stop = (e) => {
      if (!dragging) return;
      dragging = false;
      try { this.resizer.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      document.body.style.userSelect = '';
      const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--mirror-w'), 10);
      if (w) localStorage.setItem('mirrorPanelW', String(w));
    };
    this.resizer.addEventListener('pointerup', stop);
    this.resizer.addEventListener('pointercancel', stop);
  }

  // API เดิม (เผื่อโค้ดอื่นเรียก): show/hide/toggle จัดการ panel ที่เหมาะสม
  show() { this.showPanel(this.ws ? 'running' : 'devices'); }
  hide() { this.closePanel(); }
  toggle() {
    if (this.visible) this.closePanel();
    else this.show();
  }

  open(serial) {
    if (serial) { this.connect(serial); this.showPanel('running'); return; }
    this.show();
  }

  close() {
    // ตัดการเชื่อมต่อเต็มรูปแบบ + ปิดหน้าต่าง
    this.disconnect();
    this.closePanel();
  }
}

// สร้าง singleton + expose global
const panel = new MirrorPanel();
window.MirrorPanel = {
  toggle: () => panel.toggle(),
  open: (serial) => panel.open(serial),
  close: () => panel.close(),
};
