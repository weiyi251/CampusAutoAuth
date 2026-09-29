const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// 应用版本：发新版时同步更新此处，检查更新以此与 GitHub latest Release 比较
const VERSION = '1.1.0';
const GITHUB_REPO = 'weiyi251/CampusAutoAuth';

// SEA（Single Executable Application）单文件模式：
// exe 由 node + postject 注入生成，index.html / connect_xcu.ps1 / enabled.cfg 作为资产内嵌；
// 运行时脚本资产解到临时目录，凭据与开关保存在 %LOCALAPPDATA%\CampusAutoAuth\。
// 非 SEA（源码运行）时所有行为与原来完全一致。
const sea = (function () { try { return require('node:sea'); } catch (e) { return null; } })();
const IS_SEA = !!(sea && sea.isSea());
const DATA = IS_SEA
  ? path.join(process.env.LOCALAPPDATA || process.env.TEMP || 'C:\\Windows\\Temp', 'CampusAutoAuth')
  : '';
const WORK = IS_SEA
  ? path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'xcu_sea')
  : '';
// 用户偏好目录（窗口尺寸等），exe 与源码模式统一放在此，避免污染仓库
const PREF_DIR = path.join(process.env.LOCALAPPDATA || process.env.TEMP || 'C:\\Windows\\Temp', 'CampusAutoAuth');
const WINSIZE = path.join(PREF_DIR, 'window.json');

// 静默自连模式：由注册表 Run 以 --auto 参数拉起，登录后自动连接并退出，不弹 GUI
const AUTO_MODE = process.argv.slice(2).indexOf('--auto') >= 0;
const RUN_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_NAME = 'CampusAutoAuth';

const PORT = 8733;
const ROOT = path.join(__dirname, '..');
const SCRIPT = IS_SEA ? path.join(WORK, 'connect_xcu.ps1') : path.join(ROOT, 'connect_xcu.ps1');
const CFG = IS_SEA ? path.join(DATA, 'enabled.cfg') : path.join(ROOT, 'enabled.cfg');
// 凭据存储：exe 模式用 Windows DPAPI 加密后存 creds.dat（仅当前用户可解密，拷走无法还原）；
// 源码模式沿用仓库根的 creds.json（已 gitignore，方便开发时手工编辑）。
// LEGACY_CRED 是旧版 exe 留下的明文文件，首次读取时迁移并清空。
const CRED = IS_SEA ? path.join(DATA, 'creds.dat') : path.join(ROOT, 'creds.json');
const LEGACY_CRED = IS_SEA ? path.join(DATA, 'creds.json') : '';
const LOGF = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'xcu_connect.log');
const HTML = IS_SEA ? null : path.join(__dirname, 'index.html');

function sendJSON(res, obj, code) {
  code = code || 200;
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

// 只接受本机回环访问：浏览器里的恶意页面可借 DNS rebinding 把域名解析到 127.0.0.1
// 再读本机接口，校验 Host 头即可挡住（本面板总是通过 127.0.0.1/localhost 访问）。
function hostAllowed(req) {
  const h = String(req.headers.host || '').toLowerCase();
  return h === '127.0.0.1:' + PORT || h === 'localhost:' + PORT || h === '127.0.0.1' || h === 'localhost';
}

// 网络探测的回调必须只触发一次：超时后 destroy() 常伴随 error 事件，
// 若 end 与 error 都回调，上层会二次写响应头而让整个服务进程崩掉。
function onceFn(cb) {
  var done = false;
  return function (a, b) {
    if (done) { return; }
    done = true;
    cb(a, b);
  };
}

function isOnline(cb) {
  const once = onceFn(cb);
  const req = http.get(
    'http://www.msftconnecttest.com/connecttest.txt',
    { timeout: 6000 },
    function (res) {
      let data = '';
      res.on('data', function (d) { data += d; });
      res.on('end', function () { once(/Microsoft Connect Test/.test(data)); });
    }
  );
  req.on('error', function () { once(false); });
  req.on('timeout', function () { req.destroy(); once(false); });
}

// 面板轮询用的是这个：联网探测要真的发 HTTP 请求（断网时要等满超时），
// 3 秒内复用上次结果即可，避免每次轮询都去探测一次外网。
var onlineCache = { t: 0, v: null };
function isOnlineCached(cb) {
  if (onlineCache.v !== null && Date.now() - onlineCache.t < 3000) { cb(onlineCache.v); return; }
  isOnline(function (v) {
    onlineCache.v = v;
    onlineCache.t = Date.now();
    cb(v);
  });
}

function readAuto() {
  try { return fs.readFileSync(CFG, 'utf8').trim() === '1'; } catch (e) { return true; }
}

// 开机自启：写 HKCU\...\Run，值为「本程序 + --auto」。exe 版即 exe 自身路径，
// 源码版则为 node + server.js。删除即 Remove-ItemProperty。
function ps(cmd, timeout) {
  return spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', cmd],
    { encoding: 'utf8', windowsHide: true, timeout: timeout || 10000 });
}

function startupCmd() {
  const self = process.execPath.replace(/'/g, "''");
  if (IS_SEA) { return '"' + self + '" --auto'; }
  const js = path.join(__dirname, 'server.js').replace(/'/g, "''");
  return '"' + self + '" "' + js + '" --auto';
}

function autostartRegistered() {
  if (process.platform !== 'win32') { return false; }
  const r = ps("$v = (Get-ItemProperty -Path '" + RUN_KEY + "' -Name '" + RUN_NAME + "' -ErrorAction SilentlyContinue)." + RUN_NAME + "; if ($v) { Write-Output 'YES' }");
  return String(r.stdout || '').indexOf('YES') >= 0;
}

// status 每秒被前端轮询，注册表查询较贵 → 结果缓存 30 秒，开关变更时失效
var autostartCache = { t: 0, v: null };
function autostartCached() {
  if (autostartCache.v !== null && Date.now() - autostartCache.t < 30000) { return autostartCache.v; }
  autostartCache.v = autostartRegistered();
  autostartCache.t = Date.now();
  return autostartCache.v;
}

function setAutostart(on) {
  if (process.platform !== 'win32') { return false; }
  if (on) {
    ps("$p = '" + RUN_KEY + "'; Set-ItemProperty -Path $p -Name '" + RUN_NAME + "' -Value '" + startupCmd() + "' -Force");
  } else {
    ps("$p = '" + RUN_KEY + "'; Remove-ItemProperty -Path $p -Name '" + RUN_NAME + "' -ErrorAction SilentlyContinue");
  }
  // status 每秒被前端轮询，注册表查询较贵 → 结果缓存 30 秒，开关切换后失效
  autostartCache.v = null;
  return autostartRegistered() === !!on;
}

// 执行一次完整连接：同步凭据到 ps1 工作目录 → 跑 ps1 -Force → 复查是否真正联网。
// GUI「立即连接」与 --auto 静默自连共用此路径。
function doConnect(cb) {
  const c = readCred();
  const args = ['-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Force'];
  if (c.portal) { args.push('-Portal', c.portal); }
  // 凭据经环境变量传给脚本：不落任何明文文件，也不出现在进程命令行里
  const env = Object.assign({}, process.env, {
    XCU_USER: c.username,
    XCU_PASS: c.password,
    XCU_PORTAL: c.portal || ''
  });
  const r = spawnSync('powershell.exe', args,
    { encoding: 'utf8', timeout: 90000, windowsHide: true, env: env });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  rotateLog();
  isOnline(function (online) { cb(online, out); });
}

// 窗口尺寸记忆：前端拖动窗口后上报，下次启动以此尺寸打开 App 窗口
function readWinSize() {
  try {
    const j = JSON.parse(fs.readFileSync(WINSIZE, 'utf8'));
    const w = Math.min(1600, Math.max(380, parseInt(j.width, 10) || 0));
    const h = Math.min(1400, Math.max(440, parseInt(j.height, 10) || 0));
    return { width: w, height: h };
  } catch (e) { return null; }
}

function writeWinSize(w, h) {
  try {
    fs.mkdirSync(PREF_DIR, { recursive: true });
    fs.writeFileSync(WINSIZE, JSON.stringify({ width: w, height: h }), 'utf8');
    return true;
  } catch (e) { return false; }
}

// —— 凭据读写 ——
// DPAPI（CurrentUser 作用域）加解密。PowerShell 与本进程之间一律以 base64 传递，
// 避免控制台代码页把非 ASCII 字符（中文密码）破坏掉。
function dpapiProtect(plain) {
  const b64 = Buffer.from(String(plain), 'utf8').toString('base64');
  const r = ps("Add-Type -AssemblyName System.Security; "
    + "$b = [Convert]::FromBase64String('" + b64 + "'); "
    + "$e = [Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'); "
    + "[Convert]::ToBase64String($e)");
  return String(r.stdout || '').trim();
}

function dpapiUnprotect(cipher) {
  const r = ps("Add-Type -AssemblyName System.Security; "
    + "$e = [Convert]::FromBase64String('" + String(cipher).replace(/'/g, "''") + "'); "
    + "$b = [Security.Cryptography.ProtectedData]::Unprotect($e, $null, 'CurrentUser'); "
    + "[Convert]::ToBase64String($b)");
  const out = String(r.stdout || '').trim();
  if (!out) { return null; }
  return Buffer.from(out, 'base64').toString('utf8');
}

function normalizeCred(j) {
  return {
    username: String(j.username || ''),
    password: String(j.password || ''),
    portal: String(j.portal || '')
  };
}

// 旧版明文 creds.json → 加密 creds.dat，随后清空明文文件（内容已在密文里，不丢数据）
function migrateLegacyCred() {
  const empty = { username: '', password: '', portal: '' };
  let j;
  try { j = JSON.parse(fs.readFileSync(LEGACY_CRED, 'utf8')); } catch (e) { return empty; }
  const c = normalizeCred(j);
  if (!c.username && !c.password) { return empty; }
  try {
    writeCred(c.username, c.password, c.portal);
    fs.writeFileSync(LEGACY_CRED, JSON.stringify(empty, null, 2), 'utf8');
    console.log('凭据已迁移到加密存储 creds.dat，旧明文文件已清空');
  } catch (e) {
    console.error('凭据迁移失败：' + (e && e.message));
  }
  return c;
}

// 凭据只在进程内读一次（DPAPI 解密要起一次 PowerShell，约数百毫秒），
// 写入时同步更新缓存，避免前端每秒轮询都去解密。
var credCache = null;

function readCred() {
  if (credCache) { return credCache; }
  credCache = loadCred();
  return credCache;
}

function loadCred() {
  const empty = { username: '', password: '', portal: '' };
  if (IS_SEA) {
    let raw = '';
    try { raw = fs.readFileSync(CRED, 'utf8').trim(); } catch (e) { raw = ''; }
    if (raw) {
      const plain = dpapiUnprotect(raw);
      if (plain) {
        try { return normalizeCred(JSON.parse(plain)); } catch (e) {}
      }
      console.error('凭据解密失败，将视为未配置');
      return empty;
    }
    return migrateLegacyCred();
  }
  try { return normalizeCred(JSON.parse(fs.readFileSync(CRED, 'utf8'))); } catch (e) { return empty; }
}

function writeCred(username, password, portal) {
  const c = { username: username, password: password, portal: portal || '' };
  credCache = c;
  if (IS_SEA) {
    const enc = dpapiProtect(JSON.stringify(c));
    if (!enc) { throw new Error('凭据加密失败'); }
    fs.writeFileSync(CRED, enc, 'utf8');
  } else {
    fs.writeFileSync(CRED, JSON.stringify(c, null, 2), 'utf8');
  }
}

function tailLog(n) {
  try {
    const t = fs.readFileSync(LOGF, 'utf8');
    const lines = t.split(/\r?\n/).filter(function (x) { return x.trim(); });
    return lines.slice(-n);
  } catch (e) { return []; }
}

// 日志轮转：ps1 只追加不清理，长期使用会一直增长。超过阈值时只保留尾部若干行重写，
// 兼顾磁盘占用与面板读取速度（在启动、面板读日志、每次连接后各检查一次）。
const LOG_MAX = 512 * 1024;
const LOG_KEEP = 400;
function rotateLog() {
  try {
    if (fs.statSync(LOGF).size < LOG_MAX) { return; }
    const lines = fs.readFileSync(LOGF, 'utf8').split(/\r?\n/).filter(function (x) { return x.trim(); });
    fs.writeFileSync(LOGF, lines.slice(-LOG_KEEP).join('\r\n') + '\r\n', 'utf8');
  } catch (e) {}
}

function readBody(req, cb) {
  let b = '';
  req.on('data', function (d) { b += d; });
  req.on('end', function () {
    try { cb(b ? JSON.parse(b) : {}); } catch (e) { cb({}); }
  });
}

// —— 检查更新 ——
// 语义化版本比较：a 大于 b 返回正数
function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.');
  const pb = String(b).replace(/^v/, '').split('.');
  for (let i = 0; i < 3; i++) {
    const d = (parseInt(pa[i], 10) || 0) - (parseInt(pb[i], 10) || 0);
    if (d) { return d; }
  }
  return 0;
}

function fetchJson(url, timeout, cb) {
  cb = onceFn(cb);
  const req = https.get(url, {
    headers: { 'User-Agent': 'CampusAutoAuth', Accept: 'application/vnd.github+json' },
    timeout: timeout || 10000
  }, function (res) {
    if (res.statusCode !== 200) { res.resume(); cb(new Error('HTTP ' + res.statusCode)); return; }
    let d = '';
    res.on('data', function (c) { d += c; });
    res.on('end', function () {
      try { cb(null, JSON.parse(d)); } catch (e) { cb(e); }
    });
  });
  req.on('error', function (e) { cb(e); });
  req.on('timeout', function () { req.destroy(new Error('请求超时')); });
}

function downloadTo(url, dest, cb, depth) {
  depth = depth || 0;
  cb = onceFn(cb);
  if (depth > 4) { cb(new Error('重定向次数过多')); return; }
  const mod = url.indexOf('https://') === 0 ? https : http;
  const f = fs.createWriteStream(dest);
  const req = mod.get(url, { headers: { 'User-Agent': 'CampusAutoAuth' }, timeout: 300000 }, function (res) {
    // GitHub 下载链接会 302 到 release-assets CDN，需跟随重定向
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      f.close();
      downloadTo(res.headers.location, dest, cb, depth + 1);
      return;
    }
    if (res.statusCode !== 200) { res.resume(); f.close(); cb(new Error('HTTP ' + res.statusCode)); return; }
    res.pipe(f);
    f.on('finish', function () { f.close(cb); });
  });
  req.on('error', function (e) { f.close(); cb(e); });
  req.on('timeout', function () { req.destroy(new Error('下载超时')); });
}

// 多源下载：直连失败（国内网络常见）时自动换镜像加速重试，下载后做 SHA-256 校验
const GH_PROXY = 'https://gh-proxy.com/';
function downloadWithFallback(url, digest, dest, cb) {
  const tries = [url];
  if (url.indexOf('https://github.com/') === 0) { tries.push(GH_PROXY + url); }
  const tryNext = function (i) {
    if (i >= tries.length) { cb(new Error('所有下载源均失败')); return; }
    downloadTo(tries[i], dest, function (err) {
      if (err) { console.log('下载源失败(' + (i + 1) + '/' + tries.length + '):', err.message); tryNext(i + 1); return; }
      // SHA-256 校验：下载内容必须与 GitHub 官方 digest 一致（防镜像篡改/损坏）
      if (!digest) { cb(null, tries[i]); return; }
      const expect = String(digest).replace(/^sha256:/, '').toLowerCase();
      const hash = crypto.createHash('sha256');
      const s = fs.createReadStream(dest);
      s.on('data', function (c) { hash.update(c); });
      s.on('end', function () {
        const actual = hash.digest('hex');
        if (actual !== expect) { cb(new Error('校验失败：文件与官方发布不一致')); return; }
        cb(null, tries[i]);
      });
      s.on('error', function (e) { cb(e); });
    });
  };
  tryNext(0);
}

// SEA 模式初始化：内嵌资产落到临时工作目录（ps1 以 $PSScriptRoot=WORK 找配套文件），
// 凭据与开关放 %LOCALAPPDATA%\CampusAutoAuth\，exe 本体可放任意目录、保持绿色单文件。
if (IS_SEA) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.mkdirSync(WORK, { recursive: true });
    fs.writeFileSync(SCRIPT, sea.getAsset('connect_xcu.ps1', 'utf8'), 'utf8');
    if (!fs.existsSync(CFG)) {
      fs.writeFileSync(CFG, sea.getAsset('enabled.cfg', 'utf8'), 'utf8');
    }
  } catch (e) {
    console.error('SEA init failed:', e && e.message);
  }
}

// 首次运行时生成空的凭据文件模板，账号密码由用户在 GUI「配置」页填写。
// 若存在旧版明文文件则先生成空模板会跳过迁移，故此处一并判断。
if (!fs.existsSync(CRED) && !(LEGACY_CRED && fs.existsSync(LEGACY_CRED))) {
  try { writeCred('', '', ''); } catch (e) {}
}

// 启动时先检查一次日志体积（长期不开面板的场景也要轮转）
rotateLog();

// 窗口心跳：收到过至少一次心跳后才开始计时，窗口关闭超过阈值即自动退出，
// 避免残留后台 node 进程。启动后、收到首跳前不计时，以兼容启动器延时开窗口。
var lastBeat = 0;
var hasBeat = false;

const server = http.createServer(function (req, res) {
  if (!hostAllowed(req)) { res.writeHead(403); res.end('Forbidden'); return; }
  const url = req.url.split('?')[0];

  if (url === '/' || url === '/index.html') {
    if (IS_SEA) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(sea.getAsset('index.html', 'utf8'));
      return;
    }
    fs.readFile(HTML, function (err, data) {
      if (err) { res.writeHead(500); res.end('UI missing'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // 轻量存活探测：只回答「本服务在不在、什么版本」，不做联网检测。
  // 启动时判断是否已有实例必须用它——/api/status 要等外网探测，断网时会超时。
  if (url === '/api/ping') {
    sendJSON(res, { ok: true, version: VERSION });
    return;
  }

  if (url === '/api/status') {
    isOnlineCached(function (online) {
      const c = readCred();
      sendJSON(res, {
        online: online,
        auto: readAuto(),
        autostart: autostartCached(),
        username: c.username,
        hasPassword: !!c.password,
        portal: c.portal,
        version: VERSION
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

  // 明文密码按需读取：面板「显示」按钮点击时才调用，/api/status 不再随轮询回传密码
  if (url === '/api/cred/show' && req.method === 'POST') {
    const c = readCred();
    if (!c.password) { sendJSON(res, { ok: false, error: '尚未设置密码' }, 400); return; }
    sendJSON(res, { ok: true, password: c.password });
    return;
  }

  if (url === '/api/log') {
    rotateLog();
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
    doConnect(function (ok, out) {
      sendJSON(res, { ok: ok, online: ok, output: out.slice(-2000) });
    });
    return;
  }

  // 开机自启开关：读写注册表 Run 项，实际决定登录后是否自动连接
  if (url === '/api/autostart' && req.method === 'POST') {
    readBody(req, function (body) {
      const ok = setAutostart(!!body.enabled);
      if (!ok) { sendJSON(res, { ok: false, error: '设置开机自启失败，可能被安全软件拦截' }, 500); return; }
      sendJSON(res, { ok: true, autostart: autostartRegistered() });
    });
    return;
  }

  if (url === '/api/quit') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    process.exit(0);
    return;
  }

  // 保存窗口尺寸（拖动调整后由前端上报），下次启动以此尺寸打开
  if (url === '/api/winsize' && req.method === 'POST') {
    readBody(req, function (body) {
      const w = parseInt(body.width, 10);
      const h = parseInt(body.height, 10);
      const ok = w > 0 && h > 0 && writeWinSize(w, h);
      sendJSON(res, { ok: ok });
    });
    return;
  }

  // 检查更新：与 GitHub latest Release 比较版本，返回新版号/说明/exe 下载地址
  if (url === '/api/check_update') {
    fetchJson('https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest', 10000, function (err, rel) {
      if (err || !rel || !rel.tag_name) {
        sendJSON(res, { ok: false, error: err ? err.message : '未获取到版本信息' });
        return;
      }
      const exe = (rel.assets || []).find(function (a) { return a.name === 'CampusAutoAuth.exe'; });
      sendJSON(res, {
        ok: true,
        current: VERSION,
        latest: rel.tag_name,
        hasUpdate: cmpVer(rel.tag_name, VERSION) > 0,
        notes: String(rel.body || '').slice(0, 500),
        url: exe ? exe.browser_download_url : '',
        digest: exe ? (exe.digest || '') : ''
      });
    });
    return;
  }

  // 在线更新：下载新版 exe 到数据目录，生成更新脚本（等本进程退出→覆盖→重启→自删），
  // 应答后延迟退出，由脚本完成替换。仅 exe（SEA）模式支持。
  if (url === '/api/update' && req.method === 'POST') {
    readBody(req, function (body) {
      if (!IS_SEA) { sendJSON(res, { ok: false, error: '仅 exe 版支持在线更新' }, 400); return; }
      const dl = String(body.url || '');
      if (!/^https:\/\/github\.com\//.test(dl) && !/^https:\/\/release-assets\.githubusercontent\.com\//.test(dl)
        && !/^http:\/\/127\.0\.0\.1[:/]/.test(dl)) {
        sendJSON(res, { ok: false, error: '非法更新地址: ' + dl.slice(0, 120) }, 400);
        return;
      }
      const newExe = path.join(DATA, 'update.exe.new');
      downloadWithFallback(dl, String(body.digest || ''), newExe, function (err) {
        if (err) { sendJSON(res, { ok: false, error: '下载失败：' + err.message }, 502); return; }
        try {
          // ps1 用带 BOM 的 UTF-8 写入，保证中文路径/用户名下 PowerShell 也能正确解析
          // 覆盖前先备份旧 exe，新版本启动后确认存活；起不来则回滚并重新拉起旧版，
          // 避免「更新失败 → 应用打不开」这种只能手动重装的状态。
          const ps1 = path.join(DATA, 'update.ps1');
          fs.writeFileSync(ps1, '\ufeff'
            + '$exe = "' + process.execPath.replace(/'/g, "''") + '"\r\n'
            + '$new = "' + newExe.replace(/'/g, "''") + '"\r\n'
            + '$bak = "$exe.bak"\r\n'
            + 'while (Get-Process -Id ' + process.pid + ' -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }\r\n'
            + 'Start-Sleep -Milliseconds 300\r\n'
            + 'Copy-Item -LiteralPath $exe -Destination $bak -Force -ErrorAction SilentlyContinue\r\n'
            + 'Copy-Item -LiteralPath $new -Destination $exe -Force\r\n'
            + '$p = Start-Process -FilePath $exe -PassThru\r\n'
            + 'Start-Sleep -Seconds 8\r\n'
            + 'if ($p -and -not $p.HasExited) {\r\n'
            + '    Remove-Item -LiteralPath $bak -Force -ErrorAction SilentlyContinue\r\n'
            + '} else {\r\n'
            + '    Copy-Item -LiteralPath $bak -Destination $exe -Force\r\n'
            + '    Start-Process -FilePath $exe\r\n'
            + '}\r\n'
            + 'Remove-Item -LiteralPath $new -Force -ErrorAction SilentlyContinue\r\n'
            + 'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue\r\n', 'utf8');
          spawn('powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1],
            { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        } catch (e) { sendJSON(res, { ok: false, error: '生成更新脚本失败：' + e.message }, 500); return; }
        sendJSON(res, { ok: true });
        console.log('更新包下载完成，即将退出并由更新脚本替换重启');
        setTimeout(function () { process.exit(0); }, 500);
      });
    });
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
  // 静默自连模式下绝不杀进程（可能正在跑的是用户的 GUI），直接退出即可
  if (AUTO_MODE) { process.exit(1); return; }
  if (err && err.code === 'EADDRINUSE' && listenRetries < 3) {
    listenRetries++;
    console.log('端口 ' + PORT + ' 被占用，自动清理旧进程后重试…');
    killPortOccupant(PORT, function () { setTimeout(tryListen, 600); });
  } else {
    console.error('server error:', err && err.message);
    process.exit(1);
  }
});
if (AUTO_MODE) {
  // 静默自连：若已有服务在跑就转给它处理（避免杀掉正在使用的 GUI），否则自己监听并连一次
  probeService(function (alive) {
    if (alive) {
      forwardConnect(function () { process.exit(0); });
      return;
    }
    waitListening(runAutoConnect);
  });
} else {
  // 已有实例在跑：同版本就把它的窗口切到前台再退出（不打扰正在用的面板）；
  // 版本不一致（旧版残留）或窗口已不存在时才沿用端口自愈，重启为当前版本。
  probeService(function (alive, info) {
    if (!alive) { tryListen(); return; }
    if (info && info.version === VERSION && focusExistingWindow()) {
      console.log('程序已在运行，已切换到已有窗口');
      process.exit(0);
    }
    console.log('检测到已有实例（' + ((info && info.version) || '未知版本') + '），重启服务以运行当前版本');
    killPortOccupant(PORT, function () { setTimeout(tryListen, 600); });
  });
}

// 等待监听就绪后执行 cb（server 首次 listen 成功即触发）
function waitListening(cb) {
  if (server.listening) { cb(); return; }
  server.once('listening', cb);
  setTimeout(tryListen, 0);
}

function probeService(cb) {
  const once = onceFn(cb);
  // 用 /api/ping（毫秒级）而不是 /api/status：后者含外网探测，断网时最长 6 秒，
  // 会被 3 秒超时误判成「没有实例」，进而把正在使用的面板杀掉重启。
  const req = http.get('http://127.0.0.1:' + PORT + '/api/ping', { timeout: 3000 }, function (res) {
    let d = '';
    res.on('data', function (c) { d += c; });
    res.on('end', function () {
      let j = null;
      try { j = JSON.parse(d); } catch (e) {}
      once(res.statusCode === 200, j);
    });
  });
  req.on('error', function () { once(false, null); });
  req.on('timeout', function () { req.destroy(); once(false, null); });
}

// 把已在运行的面板窗口切到前台（Edge App 窗口标题取自页面 <title>）。
// 成功则本次新进程直接退出，用户看到的是原来那个面板，不会被「关掉重开」。
function focusExistingWindow() {
  if (process.platform !== 'win32') { return false; }
  const r = ps("$s = New-Object -ComObject WScript.Shell; "
    + "if ($s.AppActivate('CampusAutoAuth')) { Write-Output 'YES' }", 8000);
  return String(r.stdout || '').indexOf('YES') >= 0;
}

// 把连接请求转发给已在运行的服务（express/http 都能处理），拿不到结果也安全退出
function forwardConnect(cb) {
  cb = onceFn(cb);
  try {
    const body = '{}';
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/api/connect', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 120000
    }, function (res) {
      res.resume();
      res.on('end', cb);
    });
    req.on('error', cb);
    req.on('timeout', function () { req.destroy(); cb(); });
    req.end(body);
  } catch (e) { cb(); }
}

// 静默自连主流程：连一次，成功与否都退出，绝不在后台常驻
function runAutoConnect() {
  var done = false;
  const finish = function (code) {
    if (done) { return; }
    done = true;
    setTimeout(function () { process.exit(code); }, 300);
  };
  // 兜底看门狗：ps1 异常卡死时不至于永远挂着
  setTimeout(function () { console.log('auto connect watchdog timeout'); finish(1); }, 150000);
  doConnect(function (ok) {
    console.log(ok ? '自动连接成功' : '自动连接未完成');
    finish(ok ? 0 : 1);
  });
}

// 心跳超时自检：窗口已上报过心跳，但 10 秒内不再上报，判定窗口已关闭，退出服务。
// 启动后尚未收到首跳（hasBeat=false）时不计时，避免启动器延时开窗口期间误杀。
setInterval(function () {
  if (hasBeat && Date.now() - lastBeat > 10000) {
    console.log('窗口已关闭，自动退出服务');
    process.exit(0);
  }
}, 3000);

// SEA 模式（双击 exe）：自动打开 GUI 窗口，实现「双击即用」。--auto 为开机自连，不弹窗。
// exe 的 PE 子系统已改为 GUI（无控制台窗口），故不再需要隐藏控制台；
// 子进程统一 windowsHide，避免 powershell/cmd 作为控制台程序时闪窗。
if (IS_SEA && !AUTO_MODE) {
  (function openGui() {
    const cands = [
      (process.env['ProgramFiles(x86)'] || '') + '\\Microsoft\\Edge\\Application\\msedge.exe',
      (process.env.LOCALAPPDATA || '') + '\\Microsoft\\Edge\\Application\\msedge.exe',
      (process.env['ProgramFiles'] || '') + '\\Google\\Chrome\\Application\\chrome.exe'
    ];
    const exe = cands.find(function (c) { return c && fs.existsSync(c); });
    const args = ['--app=http://127.0.0.1:' + PORT];
    // 禁用扩展（避免翻译插件悬浮球）与内置翻译提示
    args.push('--disable-extensions', '--disable-features=Translate');
    // 沿用上次窗口尺寸，未记录过则用默认 400x600
    const sz = readWinSize();
    args.push('--window-size=' + (sz ? sz.width : 400) + ',' + (sz ? sz.height : 600));
    if (exe) {
      spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      spawn('cmd', ['/c', 'start', '', 'http://127.0.0.1:' + PORT],
        { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
    }
  })();
}
