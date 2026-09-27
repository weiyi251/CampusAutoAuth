# AGENTS.md — CampusAutoAuth（最小内核版）

> 校园网自动认证工具：连 XCU Wi-Fi → 探测门户 → 提交账号密码 → 复查联网，带本地 GUI 控制面板。

## 项目

一句话：Windows 上「连校园网 + 网页认证」全自动工具 ｜ 技术栈：PowerShell 5.1 + Node（零依赖 http 服务）+ 原生 HTML/JS ｜ 语言：对话与文档中文，代码与命令英文

关键文件：

| 路径 | 作用 | 改动注意 |
|---|---|---|
| `connect_xcu.ps1` | 主脚本，全流程逻辑 | 顶部内置默认账号密码（**真实凭据，禁止外泄**） |
| `app/server.js` | GUI 后端，端口 `127.0.0.1:8733` | CommonJS，勿改 ESM |
| `app/index.html` | GUI 前端 | 无构建，直接改 |
| `enabled.cfg` | 自动连接开关（`1`/`0`，缺失视为开） | 运行时状态 |
| `creds.json` | 账号密码（明文，已 gitignore） | **禁入库、禁读取外泄** |
| `startup/XCUAutoConnect.bat` | 开机自启入口，含**绝对路径** | 搬动仓库后需同步修改 |

## 命令

| 任务 | 命令 |
| --- | --- |
| 启动 GUI | `app\XCU-Assistant.bat`（或 `node app/server.js` 后开 http://127.0.0.1:8733） |
| 立即连接 | `scripts\connect_now.bat` / `powershell -ExecutionPolicy Bypass -File connect_xcu.ps1 -Force` |
| 开/关自动连接 | `scripts\enable_autoconnect.bat` / `scripts\disable_autoconnect.bat` |
| 语法自检 | `node --check app/server.js`；PS1 用 `powershell -NoProfile -Command "[void][System.Management.Automation.Language.Parser]::ParseFile('connect_xcu.ps1',[ref]$null,[ref]$errs); $errs"` |
| 看日志 | `type %TEMP%\xcu_connect.log` |
| 看登录页快照 | `%TEMP%\xcu_portal.html`（认证失败时自动保存） |
| 测试 | **无测试框架**——不新增依赖；用下方手动验证清单 |
| Lint / 构建 | **无**——项目无 lint、无 typecheck、无构建步骤 |

手动验证清单（代替自动化测试，交付前逐条跑）：
1. `scripts\connect_now.bat` 后 `type %TEMP%\xcu_connect.log` 末行应为 `Auth success, online`。
2. GUI 三个动作各点一次：改账号保存 → 拨开关 → 立即连接，`/api/status` 返回同步变化。
3. 断网态（关 Wi-Fi）重跑，脚本应自动重连并认证成功。

## 四条铁律

**1. 先想再写**：显式说出假设；有多种理解就列出并让我选；不确定就问，不要静默替我决定。

**2. 简洁优先**：最少代码解决当前问题；不加没要求的功能；不为单次使用的代码造抽象；**新增依赖先问**（本项目刻意零依赖）。

**3. 精准修改**：只改与任务直接相关的代码；不顺手重排代码、改格式、重命名、删注释；风格跟现有走（`server.js` 用 `function` + `var` 风格的 ES5 写法，保持一致）；发现死代码先汇报（但 `archive/` 是刻意留档，不算死代码）。

**4. 目标驱动**：把任务翻译成可验证目标——先说明「失败/复现的样子」，再改代码，验证通过才算完成；无法在本机验证的（必须连上校园网才能测的环节）明确说出来，不要假装已验证。

## 边界

- 禁改：`creds.json`（含明文密码）、`.gitignore`、`archive/`（早期探测脚本，仅留档）、`startup\XCUAutoConnect.bat` 里的绝对路径（涉及本机安装位置，改前先问）
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

- **脚本与服务端都用自身所在目录定位配置**（`$PSScriptRoot` / `__dirname/..`），整目录搬走可直接跑；唯一例外是 `startup\XCUAutoConnect.bat` 写死了绝对路径。
- `app\launch.vbs` 硬编码了 managed node 绝对路径，找不到才回落到 PATH 里的 `node`。
- `server.js` 启动若 `127.0.0.1:8733` 被占用，会**自动结束占用端口的旧进程并重试监听**（自愈单实例），无需手动去任务管理器清理残留 `node.exe`。旧进程是同用户起的 node，可安全结束；重试上限 3 次，仍失败则退出并报错。
- 门户匹配靠正则抓 `<form action>` 与 hidden input，门户改版会失效 → 看 `%TEMP%\xcu_portal.html` 调整匹配规则，不要改联网探测逻辑。
- PowerShell 工具里命令**不能含 `%`**（会被安全过滤器拦）→ 日志路径等不要用 `%TEMP%` 字面量写在 PS 命令里。
- 提交中文信息注意编码：用无 BOM UTF-8 写文件再 `git commit -F`；读 `git log` 前先设 `[Console]::OutputEncoding` 为 UTF8，否则显示乱码（仓库内容本身没坏）。
- 本项目无 ESM、无打包器，`server.js` 里不要用 `import`/`require` 混用。
