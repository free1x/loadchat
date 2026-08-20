# LoadChat

**无需安装客户端、无需公网服务器的局域网聊天与断点文件互传工具。**

[English](README.en.md) · [安全策略](SECURITY.md) · [更新记录](CHANGELOG.md) · [参与贡献](CONTRIBUTING.md)

LoadChat 可将任意一台 Windows、Linux 或 macOS 电脑变成私有聊天与文件中转站。同一局域网内的其他设备只需用浏览器打开其地址，即可单聊、群聊和传输大文件，体验接近“局域网微信 + AirDrop”。

## 界面预览

![LoadChat 单聊与文件传输界面](docs/images/chat.webp)

| 首页与设备发现 | 文件中心 |
| --- | --- |
| ![LoadChat 首页](docs/images/home.webp) | ![LoadChat 文件中心](docs/images/files.webp) |

| 图片站内大图预览 | 手机浏览器 |
| --- | --- |
| ![LoadChat 图片预览](docs/images/preview.webp) | ![LoadChat 手机端](docs/images/mobile.webp) |

## 功能亮点

- **无需账号**：浏览器自动生成设备身份，自定义昵称/头像，实时在线状态，可选管理员审批。
- **实时聊天**：大厅、单聊、群聊、回复、表情回应、输入状态、已读回执、未读角标、撤回、搜索和浏览器通知。
- **可选文字 E2EE**：双方使用可信 HTTPS 时，新增单聊文字可采用 ECDH P-256 + AES-256-GCM 端到端加密。
- **大文件传输**：4 MiB 分片、多文件/文件夹并行上传、暂停继续、缺失分片恢复、Range 断点下载、实时速度和进度。
- **文件中心**：会话级可见性、图片站内大图预览、分类/搜索、SHA-256、多选 ZIP 下载、限时/可撤销分享链接和下载次数限制。
- **本地运维**：SQLite/WAL、定时备份、排队恢复、JSONL 审计日志、自动清理、容量/流量限额、磁盘保护和状态监控。
- **局域网优先安全**：私有网段白名单、访问/管理员双密码、设备令牌、速率限制、CSP、可选 TLS，不依赖任何云端。
- **多平台部署**：Docker Compose、Windows 一键/便携包、Linux systemd 用户服务、macOS LaunchAgent、mDNS 广播和 PWA。

> 浏览器无法在未授权的情况下静默扫描整个局域网。“设备发现”是指设备打开同一个 LoadChat 后自动出现在列表中。启用 mDNS 后服务也会广播 `_http._tcp`，但主机名发现效果取决于客户端系统和网络环境。

## 快速开始

### Windows

安装 [Node.js 22.5+](https://nodejs.org/)，双击根目录的 `start-windows.cmd`。第一次运行会自动安装依赖并构建。Windows 防火墙询问时，只允许 **专用网络**。

若要复制到一台没有 Node.js 的测试电脑，可从 GitHub Releases 下载 `LoadChat-Windows-x64-*.zip`，完整解压后双击 `start-portable.cmd`。

安装/卸载登录自启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-autostart.ps1
```

### Linux / macOS

```bash
chmod +x scripts/start.sh
./scripts/start.sh
```

首次构建后可安装后台自启动：

```bash
# Linux systemd 用户服务
./scripts/install-systemd.sh

# macOS LaunchAgent
./scripts/install-launchd.sh
```

`scripts/` 中提供对应的卸载脚本。

### Docker Compose

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f loadchat
```

建议在 `.env` 填写宿主机真实局域网地址，让首页二维码指向正确地址：

```dotenv
LOADCHAT_PUBLIC_URL=http://192.168.1.20:3210
```

持久数据挂载在 `./data`，该目录已明确排除在 Git 提交之外。

## HTTPS 与端到端加密

HTTP 仅适合可信测试局域网。通知、PWA 安装、剪贴板 API 和单聊 E2EE 建议使用可信 HTTPS。安装 [mkcert](https://github.com/FiloSottile/mkcert) 后运行：

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\scripts\setup-https.ps1
```

```bash
# Linux / macOS
./scripts/setup-https.sh
```

脚本会把本地证书生成到已忽略的 `data/tls/`。每台访问设备都需要信任同一个本地 CA。证书和私钥绝不能提交到仓库。

E2EE 按单聊会话手动开启，在文字离开浏览器前完成加密。当前不覆盖文件、群聊、元数据、搜索索引和旧消息。私钥保存在浏览器站点数据中；清除站点数据后旧密文将无法解密。

## 管理与隐私

未设置管理员密码时，管理接口仅允许服务器本机回环地址访问。请从服务端电脑打开“设置”，创建独立管理员密码。正式使用建议：

1. 分别设置访问密码和管理员密码。
2. 开启设备审批，只批准已知设备。
3. 将 CIDR 限制为实际网段，防火墙只对专用网络开放端口。
4. 启用 HTTPS；不要设置路由器端口转发，不要暴露到公网。
5. 检查容量/流量限额、备份保留、历史清理和审计日志。

运行数据可能包含聊天、文件名、上传文件、设备名/IP、密码哈希和签名密钥，默认都在 `data/` 下。数据库备份覆盖 SQLite 状态；完整灾难恢复还应单独备份 `data/files/`。

文件按会话隔离：大厅文件对已连接用户可见，单聊文件仅双方可见，群聊文件仅当前群成员可见；只有发送者可以删除。分享链接在过期、撤销或达到下载次数之前属于“持有即有权访问”的凭证。

## 配置

| 环境变量 / 设置 | 默认值 | 说明 |
|---|---:|---|
| `PORT` / `LOADCHAT_PORT` | `3210` | 占用时自动尝试之后 19 个端口 |
| `LOADCHAT_NAME` | 主机名 | 首次生成的服务显示名称 |
| `LOADCHAT_DATA_DIR` | `./data` | 数据库、配置、文件、日志、备份和 TLS 目录 |
| `LOADCHAT_PUBLIC_URL` | 空 | Docker/NAT 后供二维码使用的局域网地址 |
| `LOADCHAT_TLS_CERT` / `LOADCHAT_TLS_KEY` | 存在时使用 `data/tls/*` | 显式 TLS 证书与私钥路径 |
| `retentionDays` | `30` | 历史自动清理；`0` 为永久保留 |
| `maxFileSize` | `50 GiB` | 单文件上限 |
| `maxStorageSize` | `200 GiB` | 已完成文件总容量保护值 |
| `minFreeSpace` | `1 GiB` | 必须保留的磁盘空间 |
| `maxConcurrentUploads` | `4` | 每台设备同时上传会话数 |
| `maxDailyUploadBytes` | `100 GiB` | 每台设备每日发起上传的字节数 |

大部分设置可在管理员区域修改；更改端口或 TLS 文件后需重启。

## 架构与数据库

```text
浏览器（Vue 3 / PWA）
  ├─ Socket.IO：在线状态、消息、回执、信令
  └─ HTTP：分片上传、Range/ZIP 下载、管理接口
                    │
Express + Socket.IO 服务
  ├─ SQLite/WAL：设备、会话、消息、文件、分享、审计
  ├─ 本地文件：data/files
  └─ 备份/日志/TLS：data/{backups,logs,tls}
```

主要数据表包括 `devices`、`rooms`、`room_members`、`messages`、`message_reactions`、`read_receipts`、`files`、`file_chunks`、`file_shares`、`audit_logs` 和 `schema_migrations`。

## 开发与验证

```bash
npm ci
npm run dev
npm run typecheck
npm run build
```

集成测试需要先启动一个干净的服务，默认使用 3214 端口：

```bash
PORT=3214 LOADCHAT_DATA_DIR=/tmp/loadchat-smoke node dist-server/index.js
npm run test:integration -- http://127.0.0.1:3214
```

测试覆盖管理员认证、设备审批、分片鉴权、SHA-256、分享次数/撤销、ZIP、消息回复/回应/撤回和备份下载。GitHub Actions 会自动执行同样的验证。

## 当前边界

- 文件目前通过 LoadChat 服务端中转。项目已具备 WebRTC 信令，但尚未把文件切换为浏览器直连 DataChannel。
- 普通网页在关闭后不能继续持有文件句柄。重新打开后需再次选择原文件，服务端会复用已接收的分片。
- 局域网 IP 上的可靠通知通常需要可信 HTTPS、用户授权，并受操作系统/浏览器后台策略影响。
- 磁盘加密、宿主机访问控制和备份介质安全由部署者负责。

## 开源协议

[MIT](LICENSE)
