# CampusAutoAuth（校园网自动认证）

XCU 校园网「连 Wi-Fi + 网页认证」全自动工具，带本地 GUI 控制面板。

## 目录结构

| 路径 | 作用 |
|---|---|
| `connect_xcu.ps1` | 主脚本：连 XCU → 探测门户 → 提交账号密码 → 复查联网 |
| `enabled.cfg` | 自动连接开关（`1`=开，`0`=关；文件不存在视为开） |
| `creds.json` | 账号密码（**明文，已被 .gitignore 排除**） |
| `creds.example.json` | 凭据模板，复制为 `creds.json` 后填自己的 |
| `app/` | GUI 控制面板（Node 零依赖服务 + 网页 UI，端口 127.0.0.1:8733） |
| `scripts/` | 命令行开关与立即连接（功能已被 GUI 覆盖，备用） |
| `startup/` | 开机自启用的 bat，需复制到系统「启动」文件夹 |
| `archive/` | 早期排查门户用的探测脚本，仅留档 |

## 安装

1. **凭据**：复制 `creds.example.json` → `creds.json`，填入自己的学号和密码。
   （推荐直接在 GUI「配置」页填写，保存后自动生成 `creds.json`。）
   脚本内**不内置任何账号密码**：检测不到凭据时会记录日志并直接退出，不做联网动作。
2. **开机自启**：把 `startup\XCUAutoConnect.bat` 复制到
   `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\`。
3. **GUI 启动器**：把 `app\XCU-Assistant.bat` 的快捷方式放到桌面，双击即开
   （Edge `--app` 模式独立窗口，无地址栏）。

## 用法

- 开关自动连接：GUI 里的拨动开关，或跑 `scripts\enable_autoconnect.bat` / `disable_autoconnect.bat`。
- 立即连接：GUI 点「立即连接校园网」，或跑 `scripts\connect_now.bat`（带 `-Force`，忽略开关）。
- 账号密码 / 认证网址：GUI 设置 → 「配置」页里改，页内「当前配置」卡片显示当前账号、密码（可点"显示"查看明文）与校园网网址；保存后立即生效，密码留空表示不修改。

## 路径说明

脚本与服务端都用**自身所在目录**定位配置（`PSScriptRoot` / `__dirname/..`），
整目录搬到别处也能直接跑，无需改路径。
`startup\XCUAutoConnect.bat` 除外——它写的是安装后的绝对路径，搬动仓库后需同步修改。

## 排错

- 日志：`%TEMP%\xcu_connect.log`
- 登录页快照：`%TEMP%\xcu_portal.html`（认证失败时自动保存，据此调整字段匹配规则）

## 安全提醒

`creds.json` 明文存密码，仅限本人本机使用；已加入 `.gitignore`，不会进版本库。
GUI 与服务端仅监听 `127.0.0.1`，数据不出本机。

## 免责声明

- 本工具仅用于自动化登录**你自己有权使用**的校园网账号，请遵守所在学校的网络使用规定；
- 认证门户改版可能导致脚本失效，需按快照自行调整字段匹配规则；
- 本项目按现状（AS IS）提供，仅供学习交流，作者不对使用后果承担责任。
