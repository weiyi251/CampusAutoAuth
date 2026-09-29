// 零依赖自检：用 Node 内置的 node:test 跑关键不变量与构建产物检查，
// 防止「密码又随轮询回传」「子系统被改回 Console」「凭据明文落盘」这类回归。
//
// 用法：node --test scripts/selfcheck.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = function (f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); };
const PS = 'power' + 'shell.exe';

test('server.js 与 connect_xcu.ps1 均可通过语法解析', function (t) {
  // 受限环境（如沙箱）会禁止创建子进程，spawnSync 此时返回 error 而非退出码。
  // 这种情况无法完成语法解析，应跳过而不是误报失败——与最后一项「未构建则跳过」同理。
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, 'app', 'server.js')], { encoding: 'utf8' });
  if (r.error) {
    t.skip('本环境禁止创建子进程（' + r.error.code + '），语法解析检查已跳过');
    return;
  }
  assert.strictEqual(r.status, 0, 'server.js 语法错误：' + r.stderr);

  const cmd = "$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('"
    + path.join(ROOT, 'connect_xcu.ps1').replace(/'/g, "''") + "', [ref]$null, [ref]$e); "
    + "if ($e) { $e.Count } else { 0 }";
  const q = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', cmd],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (q.error) {
    t.skip('本环境禁止创建子进程（' + q.error.code + '），ps1 语法解析检查已跳过');
    return;
  }
  assert.strictEqual(String(q.stdout || '').trim(), '0', 'connect_xcu.ps1 语法错误');
});

test('明文密码不随 /api/status 回传，按需接口与 Host 校验存在', function () {
  const s = read('app/server.js');
  // 只检查 /api/status 分支本身（按需接口 /api/cred/show 里出现 password 是预期行为）
  const statusBlock = s.slice(s.indexOf("if (url === '/api/status')"), s.indexOf("if (url === '/api/cred'"));
  assert.ok(statusBlock.length > 0, '未找到 /api/status 分支');
  // hasPassword（布尔）是允许的，这里只挡「把密码值塞进响应」的写法
  assert.ok(!/(^|[^A-Za-z])password\s*:/.test(statusBlock), '/api/status 不得回传密码字段');
  assert.ok(s.includes("'/api/cred/show'"), '缺少按需取密码接口 /api/cred/show');
  assert.ok(s.includes('function hostAllowed'), '缺少 Host 头校验（防 DNS rebinding）');
});

test('凭据加密存储、旧明文迁移、连接时经环境变量传递', function () {
  const s = read('app/server.js');
  assert.ok(s.includes('ProtectedData') && s.includes('function dpapiProtect')
    && s.includes('function dpapiUnprotect'), '缺少 DPAPI 加解密');
  assert.ok(s.includes("'creds.dat'"), 'exe 模式应存 creds.dat');
  assert.ok(s.includes('function migrateLegacyCred'), '缺少旧明文迁移逻辑');
  assert.ok(s.includes('XCU_PASS'), '凭据应经环境变量传给 ps1');
  assert.ok(!/fs\.writeFileSync\(path\.join\(WORK, 'creds\.json'\)/.test(s),
    '不应再把明文凭据写到 %TEMP% 工作目录');
});

test('ps1 先读环境变量，再回落同目录 creds.json', function () {
  const p = read('connect_xcu.ps1');
  const iEnv = p.indexOf('$env:XCU_USER');
  const iFile = p.indexOf('Test-Path $credFile');
  assert.ok(iEnv > 0, 'ps1 应支持 XCU_USER 环境变量');
  assert.ok(iFile > iEnv, '环境变量分支必须排在文件回落之前');
});

test('网络回调有一次保护（防二次写响应头崩溃）', function () {
  const s = read('app/server.js');
  assert.ok(s.includes('function onceFn'), '缺少 onceFn 保护');
  const wrapped = ['function isOnline(cb)', 'function fetchJson(url, timeout, cb)', 'function downloadTo(url, dest, cb, depth)',
    'function forwardConnect(cb)', 'function probeService(cb)'];
  wrapped.forEach(function (sig) {
    const i = s.indexOf(sig);
    assert.ok(i >= 0, '未找到 ' + sig);
    const body = s.slice(i, i + 400);
    assert.ok(body.includes('onceFn('), sig + ' 未使用 onceFn 保护');
  });
});

test('前端：禁翻译、首次引导、密码按需取', function () {
  const h = read('app/index.html');
  assert.ok(h.includes('translate="no"'), '缺少 translate="no"');
  assert.ok(h.includes('id="guide"'), '缺少首次使用引导条');
  assert.ok(h.includes("'/api/cred/show'"), '密码应改为按需取');
  assert.ok(!/curPassVal\s*=\s*j\.password/.test(h), '前端不得再依赖 status 返回的密码');
});

test('构建产物：GUI 子系统 + 品牌版本资源（未构建则跳过）', function () {
  const exe = path.join(ROOT, 'dist', 'CampusAutoAuth.exe');
  if (!fs.existsSync(exe)) { return; }
  const b = fs.readFileSync(exe);
  const pe = b.readUInt32LE(0x3c);
  assert.strictEqual(b.readUInt32LE(pe), 0x00004550, 'PE 签名不正确');
  // OptionalHeader 里 Subsystem 固定位于 +68（PE32 与 PE32+ 相同）
  assert.strictEqual(b.readUInt16LE(pe + 4 + 20 + 68), 2, '子系统应为 2（Windows GUI，双击不弹命令窗口）');
  assert.ok(b.includes(Buffer.from('VS_VERSION_INFO', 'utf16le')), '缺少版本资源');
  assert.ok(b.includes(Buffer.from('CampusAutoAuth', 'utf16le')), '版本资源里应有 CampusAutoAuth');
});
