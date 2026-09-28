const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// 应用版本：发新版时同步更新此处，检查更新以此与 GitHub latest Release 比较
const VERSION = '1.0.1';
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

const PORT = 8733;
const ROOT = path.join(__dirname, '..');
const SCRIPT = IS_SEA ? path.join(WORK, 'connect_xcu.ps1') : path.join(ROOT, 'connect_xcu.ps1');
const CFG = IS_SEA ? path.join(DATA, 'enabled.cfg') : path.join(ROOT, 'enabled.cfg');
const CRED = IS_SEA ? path.join(DATA, 'creds.json') : path.join(ROOT, 'creds.json');
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

  if (url === '/api/status') {
    isOnline(function (online) {
      const c = readCred();
      sendJSON(res, {
        online: online,
        auto: readAuto(),
        username: c.username,
        password: c.password,
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
    // SEA 模式：连接前把最新凭据与开关同步到 ps1 工作目录
    if (IS_SEA) {
      try {
        fs.writeFileSync(path.join(WORK, 'creds.json'), JSON.stringify(c, null, 2), 'utf8');
      } catch (e) {}
      try {
        fs.writeFileSync(path.join(WORK, 'enabled.cfg'), fs.readFileSync(CFG, 'utf8'), 'utf8');
      } catch (e) {}
    }
    const args = ['-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Force'];
    if (c.portal) { args.push('-Portal', c.portal); }
    const r = spawnSync(
      'powershell.exe',
      args,
      { encoding: 'utf8', timeout: 60000, windowsHide: true }
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
          const ps1 = path.join(DATA, 'update.ps1');
          fs.writeFileSync(ps1, '\ufeff'
            + '$exe = "' + process.execPath.replace(/'/g, "''") + '"\r\n'
            + '$new = "' + newExe.replace(/'/g, "''") + '"\r\n'
            + 'while (Get-Process -Id ' + process.pid + ' -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }\r\n'
            + 'Start-Sleep -Milliseconds 300\r\n'
            + 'Copy-Item -LiteralPath $new -Destination $exe -Force\r\n'
            + 'Start-Process -FilePath $exe\r\n'
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

// SEA 模式（双击 exe）：自动打开 GUI 窗口，实现「双击即用」。
// exe 的 PE 子系统已改为 GUI（无控制台窗口），故不再需要隐藏控制台；
// 子进程统一 windowsHide，避免 powershell/cmd 作为控制台程序时闪窗。
if (IS_SEA) {
  (function openGui() {
    const cands = [
      (process.env['ProgramFiles(x86)'] || '') + '\\Microsoft\\Edge\\Application\\msedge.exe',
      (process.env.LOCALAPPDATA || '') + '\\Microsoft\\Edge\\Application\\msedge.exe',
      (process.env['ProgramFiles'] || '') + '\\Google\\Chrome\\Application\\chrome.exe'
    ];
    const exe = cands.find(function (c) { return c && fs.existsSync(c); });
    if (exe) {
      spawn(exe, ['--app=http://127.0.0.1:' + PORT], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      spawn('cmd', ['/c', 'start', '', 'http://127.0.0.1:' + PORT],
        { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
    }
  })();
}
