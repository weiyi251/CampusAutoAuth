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
| `CampusAutoAuth-v1.0.1.zip` | 源码包，供自行运行或二次改造 |

> 已安装旧版？在「设置 → 偏好 → 软件版本」点「检查更新」即可在线升级。

## 使用方法（exe 版）

1. 双击 `CampusAutoAuth.exe`；
   首次运行如遇 SmartScreen 蓝色提示，点「更多信息 → 仍要运行」（exe 未做代码签名）；
2. 自动弹出控制面板（Edge App 独立窗口，无地址栏），全程无命令行黑窗口；
3. 首次使用在「配置」页填入学号、密码（如学校认证地址特殊，可一并填自定义认证网址），保存；
4. 点「立即连接校园网」：自动连 XCU Wi-Fi → 探测认证门户 → 提交凭据 → 复查联网，全程无需手动操作；
5. 平时挂着即可：可打开「自动连接」定时保活；**关闭面板窗口后服务自动退出**，不留任何后台进程。

**数据位置**：`%LOCALAPPDATA%\CampusAutoAuth\`（`creds.json` 账号密码、`enabled.cfg` 自动连接开关）。
exe 本体可放任意目录，凭据只保存在本机、不会上传。

## 功能特性

- **一键连接**：连 Wi-Fi + 网页 Portal 认证全自动
- **定时保活**：掉线自动重连，可开关
- **自定义认证网址**：门户地址特殊时手动指定，留空自动探测
- **当前配置展示**：账号、密码（可显隐）、认证网址一目了然
- **端口自愈**：启动时自动清理 8733 端口残留进程
- **关窗即退**：心跳 + bye 双机制，关闭窗口零后台残留

## 源码运行（开发者）

```
git clone https://github.com/weiyi251/CampusAutoAuth.git
```

| 路径 | 作用 |
|---|---|
| `connect_xcu.ps1` | 主脚本：连 XCU → 探测门户 → 提交账号密码 → 复查联网 |
| `enabled.cfg` | 自动连接开关（`1`=开，`0`=关；文件不存在视为开） |
| `creds.json` | 账号密码（**明文，已被 .gitignore 排除**） |
| `creds.example.json` | 凭据模板 |
| `app/` | GUI 控制面板（Node 零依赖服务 + 网页 UI，端口 127.0.0.1:8733），双击 `app\XCU-Assistant.bat` 启动 |
| `startup/` | 开机自启用的 bat，复制到系统「启动」文件夹 |
| `sea-config.json` | SEA 单文件打包配置 |

源码模式下凭据与开关存放在项目根目录，其余逻辑与 exe 版一致。

## 构建 exe

依赖 Node 22+（构建机需 npm，可用 [postject](https://github.com/nodejs/postject)）：

```
node --experimental-sea-config sea-config.json
copy <node目录>\node.exe dist\CampusAutoAuth.exe
npx postject dist\CampusAutoAuth.exe NODE_SEA_BLOB dist\sea-prep.blob ^
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

## 排错

- 连接日志：`%TEMP%\xcu_connect.log`
- 登录页快照：`%TEMP%\xcu_portal.html`（认证失败时自动保存，据此调整字段匹配规则）

## 安全提醒

`creds.json` 明文存密码，仅限本人本机使用；已加入 `.gitignore`，不会进版本库。
GUI 与服务端仅监听 `127.0.0.1`，数据不出本机。

## 免责声明

- 本工具仅用于自动化登录**你自己有权使用**的校园网账号，请遵守所在学校的网络使用规定；
- 认证门户改版可能导致脚本失效，需按快照自行调整字段匹配规则；
- 本项目按现状（AS IS）提供，仅供学习交流，按 MIT 许可证发布，作者不对使用后果承担责任。
