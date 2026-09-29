// 一键构建 dist/CampusAutoAuth.exe（SEA 单文件），四步：
//   1) 生成 SEA blob（assets 内嵌 index.html / connect_xcu.ps1 / enabled.cfg）
//   2) 以当前 node.exe 为宿主复制出 exe
//   3) postject 注入 blob
//   4) PE 后处理：子系统 Console→GUI（双击不弹黑窗）、注入图标、写版本资源
//      （不写版本资源的话「属性 → 详细信息」会显示成 Node.js）
//
// 依赖仅构建期需要，不进项目 package.json（项目本身零依赖）：
//   postject / resedit / pe-library —— 默认取 managed node 的 workspace，
//   可用环境变量 XCU_BUILD_MODULES 指向任意装好这三个包的 node_modules。
//
// 用法：<managed node> scripts/build-exe.mjs
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require2 = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const MODULES = process.env.XCU_BUILD_MODULES
  || 'C:/Users/lenovo/.workbuddy/binaries/node/workspace/node_modules';
const postject = require2(path.join(MODULES, 'postject', 'dist', 'api.js'));
const { NtExecutable, NtExecutableResource, Data, Resource } =
  await require2(path.join(MODULES, 'resedit', 'cjs.cjs')).load();

const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const distDir = path.join(root, 'dist');
const exePath = path.join(distDir, 'CampusAutoAuth.exe');
const blobPath = path.join(distDir, 'sea-prep.blob');
const icoPath = path.join(root, 'assets', 'icon.ico');

// —— 1) SEA blob ——
let r = spawnSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'],
  { cwd: root, stdio: 'inherit' });
if (r.status !== 0) { throw new Error('生成 SEA blob 失败'); }

// —— 2) 宿主 exe ——
fs.mkdirSync(distDir, { recursive: true });
try { fs.unlinkSync(exePath); } catch (e) {}
fs.copyFileSync(process.execPath, exePath);

// —— 3) 注入 blob ——
await postject.inject(exePath, 'NODE_SEA_BLOB', fs.readFileSync(blobPath), { sentinelFuse: SENTINEL });

// —— 4) PE 后处理 ——
// 版本号从 app/server.js 读取，保证与「检查更新」比较用的 VERSION 一致
const vm = fs.readFileSync(path.join(root, 'app', 'server.js'), 'utf8').match(/const VERSION\s*=\s*'([^']+)'/);
if (!vm) { throw new Error('未能从 app/server.js 读取 VERSION'); }
const version = vm[1];
const p = version.split('.').map(function (x) { return parseInt(x, 10) || 0; });

const nt = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const opt = nt.newHeader.optionalHeader;
const oldSubsystem = opt.subsystem;
opt.subsystem = 2;   // 2 = Windows GUI，3 = Console（会弹空白命令窗口）

const res = NtExecutableResource.from(nt);

// 图标：整组替换（1 = 主图标组，1033 = en-US）
const ico = fs.readFileSync(icoPath);
const icoAb = ico.buffer.slice(ico.byteOffset, ico.byteOffset + ico.byteLength);
const icons = Data.IconFile.from(icoAb).icons;
// 签名：第 1 个参数是资源项数组（不是 NtExecutableResource 对象），
// 第 4 个是 IconItem 数组——IconFile.icons 元素是 {data,width,...} 包装，需取 .data
Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icons.map(function (i) { return i.data; }));

// 版本资源
const vi = Resource.VersionInfo.createEmpty();
vi.setFileVersion(p[0] || 0, p[1] || 0, p[2] || 0, 0);
vi.setProductVersion(p[0] || 0, p[1] || 0, p[2] || 0, 0);
const strings = {
  ProductName: 'CampusAutoAuth',
  FileDescription: 'CampusAutoAuth 校园网自动认证',
  CompanyName: 'CampusAutoAuth',
  LegalCopyright: 'MIT License',
  OriginalFilename: 'CampusAutoAuth.exe',
  InternalName: 'CampusAutoAuth',
  FileVersion: version,
  ProductVersion: version
};
// 中性语言(0)与 en-US(1033) 各写一份：Windows 按翻译表里的语言去找字符串表，
// 只写 1033 时「属性 → 详细信息」会读成空值
vi.setStringValues({ lang: 0, codepage: 1200 }, strings);
vi.setStringValues({ lang: 1033, codepage: 1200 }, strings);
// 先剔除宿主自带的版本资源（node.exe 的 Node.js 信息）：语言块不一定与我们要写的
// 一致，outputToResourceEntries 匹配不上就会叠加成两份，Windows 反而读到空值
for (let i = res.entries.length - 1; i >= 0; i--) {
  if (res.entries[i].type === 16) { res.entries.splice(i, 1); }
}
vi.outputToResourceEntries(res.entries);

res.outputResource(nt);
fs.writeFileSync(exePath, Buffer.from(nt.generate()));

const size = fs.statSync(exePath).size;
console.log('构建完成：' + exePath);
console.log('  大小 ' + size + ' 字节');
console.log('  子系统 ' + oldSubsystem + ' → ' + opt.subsystem + '（2 = Windows GUI）');
console.log('  图标 ' + icons.length + ' 个尺寸');
console.log('  版本资源 v' + version + '，ProductName=CampusAutoAuth');
