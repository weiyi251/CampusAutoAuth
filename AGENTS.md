# AGENTS.md — CampusAutoAuth（最小内核版）

> 校园网自动认证工具：连 XCU Wi-Fi → 探测门户 → 提交账号密码 → 复查联网，带本地 GUI 控制面板。

## 项目

一句话：Windows 上「连校园网 + 网页认证」全自动工具 ｜ 技术栈：PowerShell 5.1 + Node（零依赖 http 服务）+ 原生 HTML/JS ｜ 语言：对话与文档中文，代码与命令英文

关键文件：

| 路径 | 作用 | 改动注意 |
|---|---|---|
| `connect_xcu.ps1` | 主脚本：连 Wi-Fi → 探测门户 → 提交凭据 → 复查联网 | 凭据来自环境变量（GUI 传入）或同目录 `creds.json`，脚本内**不写账号** |
| `scripts/build-exe.mjs` | 一键构建 exe（SEA blob → 注入 → PE 后处理） | 构建期依赖 postject/resedit/pe-library，见脚本头注释 |
| `assets/icon.ico` | 打包进 exe 的图标（7 个尺寸） | 换图标后需重新构建 exe |
| `app/server.js` | GUI 后端，端口 `127.0.0.1:8733` | CommonJS，勿改 ESM |
| `app/index.html` | GUI 前端 | 无构建，直接改 |
| `enabled.cfg` | 自动连接开关（`1`/`0`，缺失视为开） | 运行时状态 |
| `creds.json` | **源码模式**的账号密码（明文，已 gitignore） | **禁入库、禁读取外泄**；exe 模式改用 DPAPI 加密的 `creds.dat`（位于 `%LOCALAPPDATA%\CampusAutoAuth\`） |
| `startup/XCUAutoConnect.bat` | 开机自启 bat 的**历史模板**（供他人手工安装）。**本机安装副本已于 2026-09-29 停用**，备份在 `%LOCALAPPDATA%\CampusAutoAuth\backup\` | 自启**唯一路径**是注册表 Run（偏好页开关）；此模板含**绝对路径**，搬动仓库需同步修改 |

## 命令

| 任务 | 命令 |
| --- | --- |
| 启动 GUI（**日常开发走这条**） | `app\XCU-Assistant.bat`（或 `node app/server.js` 后开 http://127.0.0.1:8733） |
| 立即连接 | `scripts\connect_now.bat` / `powershell -ExecutionPolicy Bypass -File connect_xcu.ps1 -Force` |
| 开/关自动连接 | `scripts\enable_autoconnect.bat` / `scripts\disable_autoconnect.bat` |
| 语法自检 | `node --check app/server.js`；PS1 用 `powershell -NoProfile -Command "[void][System.Management.Automation.Language.Parser]::ParseFile('connect_xcu.ps1',[ref]$null,[ref]$errs); $errs"` |
| 看日志 | `type %TEMP%\xcu_connect.log` |
| 看登录页快照 | `%TEMP%\xcu_portal.html`（认证失败时自动保存） |
| 自检 | `node --test scripts/selfcheck.js`——node 内置测试器，零依赖，覆盖 7 项关键不变量 |
| 测试 | **无第三方框架**——不新增依赖；关键不变量走上行自检，其余用下方手动验证清单 |
| 构建 exe（**仅发布时**，见上方工作流约定） | `node scripts/build-exe.mjs`（需 postject/resedit/pe-library，路径见脚本头） |
| Lint / typecheck | **无**——项目无 lint、无 typecheck |

手动验证清单（代替自动化测试，交付前逐条跑）：
1. `scripts\connect_now.bat` 后 `type %TEMP%\xcu_connect.log` 末行应为 `Auth success, online`。
2. GUI 三个动作各点一次：改账号保存 → 拨开关 → 立即连接，`/api/status` 返回同步变化。
3. 断网态（关 Wi-Fi）重跑，脚本应自动重连并认证成功。

## 工作流约定（用户 2026-09-29 指定）

**日常只跑源码版，只有用户明确说「发布」时才打包 exe 并发布。**

1. **日常开发 = 源码版**：改完代码刷新浏览器即可验证，**不要**构建 exe。
   - 启动：`app\XCU-Assistant.bat`（或 `node app/server.js` 后开 http://127.0.0.1:8733）
   - 本机开机自启也**刻意**指向源码版（注册表 `Run` = `node.exe app\server.js --auto`），所以本仓库目录**不可搬动或重命名**；系统 `C:\Program Files\nodejs\node.exe` 换路径同样会让自启失效。
2. **「发布」= 一次走完这一串**（缺一步都不算完成）：
   升 `app/server.js` 的 `VERSION` → `node scripts/build-exe.mjs` → 提交 → 推送 → 创建 GitHub Release → 上传 `CampusAutoAuth.exe` 资产。
3. **未获「发布」指令时禁止**：改动 `VERSION`、构建 exe、`git push`、发 Release。日常改动**只提交本地 commit**。
4. 因此 `dist/CampusAutoAuth.exe` 长期落后于源码是**预期状态**，不代表构建失败或需要重建。

## 四条铁律

**1. 先想再写**：显式说出假设；有多种理解就列出并让我选；不确定就问，不要静默替我决定。

**2. 简洁优先**：最少代码解决当前问题；不加没要求的功能；不为单次使用的代码造抽象；**新增依赖先问**（本项目刻意零依赖）。

**3. 精准修改**：只改与任务直接相关的代码；不顺手重排代码、改格式、重命名、删注释；风格跟现有走（`server.js` 用 `function` + `var` 风格的 ES5 写法，保持一致）；发现死代码先汇报（但 `archive/` 是刻意留档，不算死代码）。

**4. 目标驱动**：把任务翻译成可验证目标——先说明「失败/复现的样子」，再改代码，验证通过才算完成；无法在本机验证的（必须连上校园网才能测的环节）明确说出来，不要假装已验证。

## 边界

- 禁改：`creds.json`（含明文密码）、`.gitignore`、`archive/`（早期探测脚本，仅留档）、`startup\XCUAutoConnect.bat` 里的绝对路径（涉及本机安装位置，改前先问；本机安装副本已于 2026-09-29 停用）
- 破坏性命令（`rm -rf`、`--force` push、删系统启动项、改 WLAN 配置）执行前必须说明并等我确认
- **禁止把真实学号、密码写进代码、日志、commit message、文档或回答**；`connect_xcu.ps1` 顶部的默认凭据只可原地保留，不得复制到新文件
- 不要把 `creds.json` 加入版本库；git 写操作只 `git add` 自己明确改的文件，**禁止 `git add -A`**

## 每次改动必做三件事（缺一不可）

**① 提交 Git commit**：改动完成后立即提交，不留在工作区。格式 `type(scope): 描述`，一次提交只做一件事。未经我同意不得 `--amend`、`--force` push 或改写已有历史。

**② 跑验证**：按上面「手动验证清单」逐条验证并**在汇报里贴出实际输出**（日志末行 / API 返回）。确实无法自动化也**必须说明原因和我的手动验证步骤**。测试类失败要修根因，不得靠删代码绕过。

**③ 写交接文档**：把本次变更同步写入 `HANDOFF.md`（**首次改动时创建**，追加到文件顶部），包含四项：改了什么及原因、影响的文件/接口/数据、如何验证、遗留问题与下一步建议。上下文过长或任务跨多轮时，同样在此留下 handoff summary，供下一次会话接续。

## 完成标准

改动可追溯到需求 → **验证清单已跑且贴出实际输出** → **已提交 Git commit** → **已写入 `HANDOFF.md`** → `README.md` 与 `AGENTS.md` 中受影响的操作说明已同步 → 汇报时说明验证方式。

## 踩坑记录

- **脚本与服务端都用自身所在目录定位配置**（`$PSScriptRoot` / `__dirname/..`），整目录搬走可直接跑；唯一例外是 `startup\XCUAutoConnect.bat` 写死了绝对路径（该模板本机已停用，见上表）。
- **开机自启只应有注册表 Run 一条路**：启动文件夹里的 bat 会绕过 server.js 直接跑 `connect_xcu.ps1`，与 Run 项构成重复触发（日志表现为同一分钟内相隔数秒两次 `XCU auto-connect start`），且它读**源码目录**的 `enabled.cfg`，切到 exe 版后会脱离 GUI 开关控制。判断某次启动来自哪个入口：看凭据行——`Credentials loaded from environment` 是 server.js 路径，`from creds.json` 是 bat 路径。
- `app\launch.vbs` 依次在 `C:\Program Files\nodejs\node.exe`、`C:\Program Files (x86)\nodejs\node.exe` 里找 node，都找不到才回落到 PATH 里的 `node`。本机实际命中**系统 Node v24.19.0**，而 exe 是用 managed Node 22 打包的——两条路径都需保持兼容。
- `server.js` 启动先探测 `127.0.0.1:8733`：已有**同版本**实例在跑就把它的窗口切到前台（`WScript.Shell.AppActivate('CampusAutoAuth')`）后自己退出，不再「关掉重开」；版本不一致或窗口已不存在时，才结束旧进程重试监听（自愈单实例，重试上限 3 次，仍失败则退出并报错）。旧进程是同用户起的 node，可安全结束。
- **判断「是否已有实例」只能用 `/api/ping`**：`/api/status` 含外网探测，断网时要等满 6 秒，会被 3 秒超时误判成「没有实例」，进而把用户正在使用的面板杀掉重启。
- 网络类回调（`isOnline`/`fetchJson`/`downloadTo`/`forwardConnect`/`probeService`）一律用 `onceFn()` 包一层：超时后 `destroy()` 常伴随 `error` 事件，`end` 与 `error` 都回调会让上层二次写响应头，**直接崩掉整个服务进程**（真机已复现 `ERR_HTTP_HEADERS_SENT`）。
- 门户匹配靠正则抓 `<form action>` 与 hidden input，门户改版会失效 → 看 `%TEMP%\xcu_portal.html` 调整匹配规则，不要改联网探测逻辑。
- PowerShell 工具里命令**不能含 `%`**（会被安全过滤器拦）→ 日志路径等不要用 `%TEMP%` 字面量写在 PS 命令里。
- 提交中文信息注意编码：用无 BOM UTF-8 写文件再 `git commit -F`；读 `git log` 前先设 `[Console]::OutputEncoding` 为 UTF8，否则显示乱码（仓库内容本身没坏）。
- 本项目无 ESM、无打包器，`server.js` 里不要用 `import`/`require` 混用。
- **凭据不在明文文件里流转**：`doConnect()` 把账号密码经**环境变量**（`XCU_USER`/`XCU_PASS`/`XCU_PORTAL`）传给 ps1，ps1 先读环境变量、再回落 `creds.json`。不要再往 `%TEMP%` 写 `creds.json`。
- **DPAPI 加解密在 Node 与 PowerShell 之间一律走 base64**：直接回传字符串会被控制台代码页破坏（中文密码变乱码）。`dpapiProtect`/`dpapiUnprotect` 见 `server.js`，单次约 300ms，故凭据在进程内缓存（`credCache`），改凭据时同步更新缓存。
- `/api/status` **不得回传明文密码**（前端轮询每秒一次），需要明文时用 `POST /api/cred/show`（点「显示」才调用）。所有接口都过 `hostAllowed()`，只认 `127.0.0.1`/`localhost`，防 DNS rebinding。
