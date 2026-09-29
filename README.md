<p align="center">
  <img src="assets/icon.png" width="120" alt="CampusAutoAuth 图标">
</p>

# CampusAutoAuth（校园网自动认证）

XCU 校园网「连 Wi-Fi + 网页认证」全自动工具，带本地 GUI 控制面板。
**免安装，单个 exe 双击即用。**

## 下载

从 [Releases](https://github.com/weiyi251/CampusAutoAuth/releases) 下载：

| 文件 | 说明 |
|---|---|
| `CampusAutoAuth.exe` | **免安装版（推荐）**，Windows 10+，无需安装 Node |
| `CampusAutoAuth-v1.1.0.zip` | 源码包，供自行运行或二次改造 |

> 已安装旧版？在「设置 → 更新」点「检查更新」即可在线升级。

## 使用方法（exe 版）

1. 双击 `CampusAutoAuth.exe`；
   首次运行如遇 SmartScreen 蓝色提示，点「更多信息 → 仍要运行」（exe 未做代码签名）；
2. 自动弹出控制面板（Edge App 独立窗口，无地址栏），全程无命令行黑窗口；
3. 首次使用在「配置」页填入学号、密码（如学校认证地址特殊，可一并填自定义认证网址），保存；
4. 点「立即连接校园网」：自动连 XCU Wi-Fi → 探测认证门户 → 提交凭据 → 复查联网，全程无需手动操作；
5. 想让开机就自动联网：到「设置 → 偏好」打开**开机自动连接**（会写入系统自启项），详见下方说明；
6. 界面主题在「设置 → 偏好 → 外观」切换：深色 / 浅色 / 跟随系统。

> 面板窗口关闭后 GUI 服务会自动退出，不留后台进程；开机联网由系统自启项负责触发，两者互不影响。

## 开机自动连接

「设置 → 偏好 → 开机自动连接」开关会直接写 Windows 开机启动项
（`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` → `CampusAutoAuth` = `"exe 路径" --auto`）：

- **开启**：每次登录 Windows，系统后台拉起本程序完成一次认证，成功后自行退出，不弹窗口、不常驻后台；
- **关闭**：删除该启动项（也可用任务管理器「启动」页管理）；
- **移动 exe 后请重新开关一次**：启动项记录的是 exe 绝对路径，换目录会导致旧记录失效；
- 认证过程与「立即连接」完全一致，日志同样写入 `%TEMP%\xcu_connect.log`。

**数据位置**：`%LOCALAPPDATA%\CampusAutoAuth\`（`creds.dat` 账号密码、`enabled.cfg` 自动连接开关、`window.json` 窗口尺寸）。
账号密码用 Windows DPAPI 加密保存，只有当前 Windows 用户能解密；从旧版本升级时，首次启动会把旧的明文
`creds.json` 迁移过来并清空原文件。
界面主题偏好存在浏览器本地（Edge 配置目录），不影响上述数据。
exe 本体可放任意目录，凭据只保存在本机、不会上传。

## 功能特性

- **一键连接**：连 Wi-Fi + 网页 Portal 认证全自动
- **开机自动连接**：开关直写系统启动项，登录后自动认证并自行退出
- **在线更新**：更新页检查新版本，一键下载替换（SHA-256 校验，直连失败自动换镜像）
- **深浅主题**：深色 / 浅色 / 跟随系统三态可选
- **自定义认证网址**：门户地址特殊时手动指定，留空自动探测
- **当前配置展示**：账号、密码（点击才按需取回明文）、认证网址一目了然
- **单实例**：已在运行则把已有面板切到前台后自身退出（不再关掉重开）；只有旧版残留才清理重启
- **首次使用引导**：未填账号时主页直接给出配置入口，不会点了连接才发现用不了
- **更新可回滚**：新版启动失败时自动还原上一版本，不会卡在打不开的状态
- **日志轮转**：连接日志超过 512KB 自动只保留尾部，长期使用不会无限增长
- **关窗即退**：心跳 + bye 双机制，关闭窗口零后台残留
- **窗口记忆**：调整过的大小下次打开保持不变

## 源码运行（开发者）

```
git clone https://github.com/weiyi251/CampusAutoAuth.git
```

| 路径 | 作用 |
|---|---|
| `connect_xcu.ps1` | 主脚本：连 XCU → 探测门户 → 提交账号密码 → 复查联网 |
| `enabled.cfg` | 自动连接开关（`1`=开，`0`=关；文件不存在视为开） |
| `creds.json` | **源码模式**下的账号密码（明文，已被 .gitignore 排除；exe 版改用 DPAPI 加密的 `creds.dat`） |
| `creds.example.json` | 凭据模板 |
| `assets/` | 应用图标（`icon.png` 源图、`icon.ico` 打包用） |
| `scripts/build-exe.mjs` | 一键构建 exe（见下方「构建 exe」） |
| `app/` | GUI 控制面板（Node 零依赖服务 + 网页 UI，端口 127.0.0.1:8733），双击 `app\XCU-Assistant.bat` 启动 |
| `startup/` | 开机自启 bat 的历史模板（需手动复制到系统「启动」文件夹）。**不推荐**：它会与偏好页开关写入的注册表自启项**重复触发**，请直接用偏好页开关 |
| `sea-config.json` | SEA 单文件打包配置 |

源码模式下凭据与开关存放在项目根目录，其余逻辑与 exe 版一致。

## 构建 exe

依赖 Node 22+，以及构建期工具 [postject](https://github.com/nodejs/postject) 与
[resedit](https://github.com/jet2jet/resedit-js) / pe-library：

```
node scripts/build-exe.mjs
```

脚本依次完成：生成 SEA blob（把 `index.html`/`connect_xcu.ps1`/`enabled.cfg` 内嵌）→
以当前 node.exe 为宿主复制出 exe → postject 注入 blob → PE 后处理：

1. 子系统 `Console` → `Windows GUI`，双击不再弹出空白命令窗口；
2. 注入 `assets/icon.ico`；
3. 写入版本资源，使「属性 → 详细信息」显示 CampusAutoAuth 而不是 node.exe。

版本号自动取自 `app/server.js` 里的 `VERSION`，与「检查更新」比较用的版本始终一致。
三个构建期依赖默认从 managed node 的 workspace 读取，可设环境变量 `XCU_BUILD_MODULES`
指向其它装好它们的 `node_modules` 目录。

## 排错

- 连接日志：`%TEMP%\xcu_connect.log`
- 登录页快照：`%TEMP%\xcu_portal.html`（认证失败时自动保存，据此调整字段匹配规则）

## 安全提醒

- **exe 版**：账号密码以 Windows DPAPI 加密存放，只有当前 Windows 用户能解密，文件被拷走也读不出内容；
- **源码版**：凭据仍是仓库根的 `creds.json`（明文，已 `.gitignore`），仅限本机自用；
- 服务端只监听 `127.0.0.1` 并校验 Host 头（防 DNS rebinding），面板也只按需取回密码而不随轮询回传；
- 连接时凭据经环境变量传给 PowerShell 脚本，不落任何明文临时文件。

## 免责声明

- 本工具仅用于自动化登录**你自己有权使用**的校园网账号，请遵守所在学校的网络使用规定；
- 认证门户改版可能导致脚本失效，需按快照自行调整字段匹配规则；
- 本项目按现状（AS IS）提供，仅供学习交流，按 MIT 许可证发布，作者不对使用后果承担责任。
