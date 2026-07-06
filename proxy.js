const path = require('path');
const crypto = require('crypto');
const { Proxy } = require('http-mitm-proxy');

const MAX_FLOWS = 300;
const MAX_BODY = 200 * 1024; // เก็บ body สูงสุด 200KB ต่อฝั่ง เพื่อไม่ให้หน่วยความจำบวม

// อ่าน chunk เป็นข้อความถ้าเป็น text ไม่งั้นบอกว่าเป็น binary
function bufferToDisplay(buf, contentType) {
  if (!buf || !buf.length) return null;
  const ct = (contentType || '').toLowerCase();
  const looksText = /json|text|xml|javascript|urlencoded|html|csv/.test(ct) || ct === '';
  if (looksText) {
    const text = buf.toString('utf8');
    if (!text.includes('�')) {
      return buf.length > MAX_BODY
        ? text.slice(0, MAX_BODY) + `\n...(ตัด ${buf.length - MAX_BODY} bytes)`
        : text;
    }
  }
  return `(binary ${buf.length} bytes${ct ? ', ' + ct.split(';')[0] : ''})`;
}

function capChunks(chunks, limit) {
  let total = 0;
  const kept = [];
  for (const c of chunks) {
    if (total >= limit) break;
    kept.push(c);
    total += c.length;
  }
  return Buffer.concat(kept);
}

/**
 * เริ่ม MITM proxy
 * @param {object} opts
 * @param {number} opts.port       พอร์ตของ proxy
 * @param {string} opts.caDir      โฟลเดอร์เก็บ CA/certs
 * @param {object} opts.store      { flows: [], clients: Set } แชร์กับ web server
 * @param {function} opts.onFlow   callback(flow) เรียกเมื่อ flow เสร็จ (ใช้ broadcast)
 */
function startProxy({ port, caDir, store, onFlow }) {
  const proxy = new Proxy();
  proxy.use(Proxy.gunzip); // คลาย gzip/deflate ของ response ให้อ่าน body ได้

  proxy.onError((ctx, err, errorKind) => {
    // ctx อาจเป็น null ตอน handshake ล้มเหลว
    if (!ctx || !ctx.clientToProxyRequest) return;
    const req = ctx.clientToProxyRequest;
    const flow = ctx.__flow;
    if (flow) {
      flow.error = `${errorKind}: ${err.message}`;
      flow.durationMs = Date.now() - flow._startedAt;
      finalize(flow);
    }
  });

  function finalize(flow) {
    delete flow._startedAt;
    delete flow._reqChunks;
    delete flow._resChunks;
    store.flows.unshift(flow);
    while (store.flows.length > MAX_FLOWS) store.flows.pop();
    onFlow(flow);
  }

  proxy.onRequest((ctx, callback) => {
    const req = ctx.clientToProxyRequest;
    const host = req.headers.host || (ctx.proxyToServerRequestOptions && ctx.proxyToServerRequestOptions.host) || '?';
    const scheme = ctx.isSSL ? 'https' : 'http';
    const flow = {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      scheme,
      method: req.method,
      host,
      path: req.url,
      url: `${scheme}://${host}${req.url}`,
      reqHeaders: req.headers,
      reqBody: null,
      status: null,
      statusText: null,
      resHeaders: null,
      resBody: null,
      resContentType: null,
      durationMs: null,
      error: null,
      _startedAt: Date.now(),
      _reqChunks: [],
      _resChunks: [],
    };
    ctx.__flow = flow;

    ctx.onRequestData((ctx, chunk, cb) => {
      flow._reqChunks.push(chunk);
      return cb(null, chunk);
    });
    ctx.onRequestEnd((ctx, cb) => {
      flow.reqBody = bufferToDisplay(capChunks(flow._reqChunks, MAX_BODY + 4096), flow.reqHeaders['content-type']);
      return cb();
    });

    ctx.onResponse((ctx, cb) => {
      const resp = ctx.serverToProxyResponse;
      flow.status = resp.statusCode;
      flow.statusText = resp.statusMessage;
      flow.resHeaders = resp.headers;
      flow.resContentType = resp.headers['content-type'] || null;
      ctx.onResponseData((ctx, chunk, cb2) => {
        flow._resChunks.push(chunk);
        return cb2(null, chunk);
      });
      ctx.onResponseEnd((ctx, cb2) => {
        flow.resBody = bufferToDisplay(capChunks(flow._resChunks, MAX_BODY + 4096), flow.resContentType);
        flow.durationMs = Date.now() - flow._startedAt;
        finalize(flow);
        return cb2();
      });
      return cb();
    });

    return callback();
  });

  return new Promise((resolve, reject) => {
    proxy.listen({ port, sslCaDir: caDir }, (err) => {
      if (err) return reject(err);
      resolve({ proxy, caPath: path.join(caDir, 'certs', 'ca.pem') });
    });
  });
}

module.exports = { startProxy };
