# Security Policy / 安全策略

[中文](#中文) · [English](#english)

## 中文

LoadChat 面向可信局域网，不应直接暴露到互联网。部署时请设置访问密码和独立管理员密码、启用设备审批、只开放专用网络防火墙，并避免路由器端口转发。

### 支持版本

| 版本 | 安全更新 |
|---|---|
| 1.1.x | ✅ |
| 1.0.x 及更早 | ❌ |

### 报告漏洞

请使用 GitHub 仓库的 **Security → Report a vulnerability** 私密报告功能，不要在公开 Issue 中披露漏洞、访问令牌、IP、日志或复现数据。报告中请提供受影响版本、影响、复现步骤和建议修复方式。维护者会尽快确认并协调披露时间。

### 安全边界

- 默认数据保存在部署主机的 `data/` 中；保护该目录等同于保护聊天和文件。
- HTTPS 保护传输链路。HTTP 模式不提供网络窃听防护。
- 可选私聊端到端加密只覆盖新发送的文字消息；文件、群聊、元数据和既有消息不在其范围内。
- E2EE 私钥保存在浏览器站点数据中；清除站点数据会失去旧密文的解密能力。
- 临时分享链接是持有者凭证，请设置短有效期和下载次数上限。

## English

LoadChat is designed for trusted LANs and must not be exposed directly to the Internet. Set separate access and administrator passwords, enable device approval, allow only private-network firewall access, and do not configure router port forwarding.

### Supported versions

| Version | Security updates |
|---|---|
| 1.1.x | ✅ |
| 1.0.x and older | ❌ |

### Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** private reporting flow. Do not disclose vulnerabilities, tokens, IP addresses, logs, or reproduction data in a public issue. Include the affected version, impact, reproduction steps, and any proposed remediation.

### Security boundaries

- Runtime data is stored under `data/`; filesystem access to this directory grants access to messages and files.
- HTTPS protects data in transit. HTTP mode does not protect against network eavesdropping.
- Optional direct-message E2EE covers newly sent text only, not files, groups, metadata, or existing messages.
- E2EE private keys live in browser site storage. Clearing site data makes old ciphertext undecryptable.
- Share links are bearer credentials; use short expirations and download limits.
