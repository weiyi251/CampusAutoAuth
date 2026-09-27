const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PORT = 8733;
const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'connect_xcu.ps1');
const CFG = path.join(ROOT, 'enabled.cfg');
const CRED = path.join(ROOT, 'creds.json');
const LOGF = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'xcu_connect.log');
const HTML = path.join(__dirname, 'index.html');

function sendJSON(res, obj, code) {
  code = code || 200;
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function isOnline(cb) {
  const req = http.get(
    'http://www.msftconnecttest.com/connecttest.txt',
    { timeout: 6000 },
    function (res) {
      let data = '';
      res.on('data', function (d) { data += d; });
      res.on('end', function () { cb(/Microsoft Connect Test/.test(data)); });
    }
  );
  req.on('error', function () { cb(false); });
  req.on('timeout', function () { req.destroy(); cb(false); });
}

function readAuto() {
  try { return fs.readFileSync(CFG, 'utf8').trim() === '1'; } catch (e) { return true; }
}

function readCred() {
  try {
    const j = JSON.parse(fs.readFileSync(CRED, 'utf8'));
    return { username: String(j.username || ''), password: String(j.password || ''), portal: String(j.portal || '') };
  } catch (e) { return { username: '', password: '', portal: '' }; }
}

function writeCred(username, password, portal) {
  fs.writeFileSync(CRED, JSON.stringify({ username: username, password: password, portal: portal || '' }, null, 2), 'utf8');
}

function tailLog(n) {
  try {
    const t = fs.readFileSync(LOGF, 'utf8');
    const lines = t.split(/\r?\n/).filter(function (x) { return x.trim(); });
    return lines.slice(-n);
  } catch (e) { return []; }
}

function readBody(req, cb) {
  let b = '';
  req.on('data', function (d) { b += d; });
  req.on('end', function () {
    try { cb(b ? JSON.parse(b) : {}); } catch (e) { cb({}); }
  });
}

// 首次运行时生成空的 creds.json 模板，账号密码由用户在 GUI「配置」页填写
if (!fs.existsSync(CRED)) {
  try { writeCred('', '', ''); } catch (e) {}
}

// 窗口心跳：收到过至少一次心跳后才开始计时，窗口关闭超过阈值即自动退出，
// 避免残留后台 node 进程。启动后、收到首跳前不计时，以兼容启动器延时开窗口。
var lastBeat = 0;
var hasBeat = false;

const server = http.createServer(function (req, res) {
  const url = req.url.split('?')[0];

  if (url === '/' || url === '/index.html') {
    fs.readFile(HTML, function (err, data) {
      if (err) { res.writeHead(500); res.end('UI missing'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (url === '/api/status') {
    isOnline(function (online) {
      const c = readCred();
      sendJSON(res, {
        online: online,
        auto: readAuto(),
        username: c.username,
        password: c.password,
        hasPassword: !!c.password,
        portal: c.portal
      });
    });
    return;
  }

  if (url === '/api/cred' && req.method === 'POST') {
    readBody(req, function (body) {
      try {
        const cur = readCred();
        const u = String(body.username || '').trim();
        const p = String(body.password || '');
        const portal = String(body.portal || '').trim();
        if (!u) { sendJSON(res, { ok: false, error: '账号不能为空' }, 400); return; }
        // 密码留空表示保持原密码不变
        const finalPass = p || cur.password;
        if (!finalPass) { sendJSON(res, { ok: false, error: '尚未设置密码' }, 400); return; }
        writeCred(u, finalPass, portal);
        sendJSON(res, { ok: true, username: u, hasPassword: true, hasPortal: !!portal });
      } catch (e) { sendJSON(res, { ok: false, error: String(e) }, 500); }
    });
    return;
  }

  if (url === '/api/log') {
    sendJSON(res, { lines: tailLog(40) });
    return;
  }

  if (url === '/api/auto' && req.method === 'POST') {
    readBody(req, function (body) {
      try {
        fs.writeFileSync(CFG, body.enabled ? '1' : '0', 'utf8');
        sendJSON(res, { ok: true, auto: readAuto() });
      } catch (e) { sendJSON(res, { ok: false, error: String(e) }, 500); }
    });
    return;
  }

  if (url === '/api/connect' && req.method === 'POST') {
    const c = readCred();
    const args = ['-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Force'];
    if (c.portal) { args.push('-Portal', c.portal); }
    const r = spawnSync(
      'powershell.exe',
      args,
      { encoding: 'utf8', timeout: 60000 }
    );
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    isOnline(function (online) {
      sendJSON(res, { ok: online, online: online, output: out.slice(-2000) });
    });
    return;
  }

  if (url === '/api/quit') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    process.exit(0);
    return;
  }

  // 窗口存活心跳：前端定时调用，用于判定窗口是否仍在
  if (url === '/api/heartbeat') {
    lastBeat = Date.now();
    hasBeat = true;
    sendJSON(res, { ok: true });
    return;
  }

  // 窗口关闭时前端主动通知：立即退出服务，不留残留
  if (url === '/api/bye') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    console.log('收到窗口关闭通知，退出服务');
    process.exit(0);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// 端口被占用（多为上次未退出的残留服务）时，先结束占用者再重试监听，
// 保证始终只有一个实例、且运行的是最新代码，无需手动去任务管理器清理残留 node.exe。
function killPortOccupant(port, cb) {
  try {
    spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '$c = Get-NetTCPConnection -LocalPort ' + port + ' -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ' +
      'if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }'
    ], { windowsHide: true, timeout: 8000 });
  } catch (e) {}
  if (cb) { cb(); }
}

var listenRetries = 0;
function tryListen() { server.listen(PORT, '127.0.0.1'); }
server.on('error', function (err) {
  if (err && err.code === 'EADDRINUSE' && listenRetries < 3) {
    listenRetries++;
    console.log('端口 ' + PORT + ' 被占用，自动清理旧进程后重试…');
    killPortOccupant(PORT, function () { setTimeout(tryListen, 600); });
  } else {
    console.error('server error:', err && err.message);
    process.exit(1);
  }
});
tryListen();

// 心跳超时自检：窗口已上报过心跳，但 10 秒内不再上报，判定窗口已关闭，退出服务。
// 启动后尚未收到首跳（hasBeat=false）时不计时，避免启动器延时开窗口期间误杀。
setInterval(function () {
  if (hasBeat && Date.now() - lastBeat > 10000) {
    console.log('窗口已关闭，自动退出服务');
    process.exit(0);
  }
}, 3000);
