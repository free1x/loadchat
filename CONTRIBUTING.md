# Contributing / 参与贡献

感谢你帮助改进 LoadChat。提交改动前请先搜索现有 Issue；涉及新功能或协议变化时，建议先创建讨论说明使用场景与兼容性影响。

## 本地开发

```bash
npm ci
npm run dev
```

提交前运行：

```bash
npm run typecheck
npm run build
```

请勿提交 `data/`、`.env`、证书、日志、构建产物或真实聊天/文件。新增接口必须保持会话权限校验，文件接口还应验证设备令牌；安全相关改动请同时更新 `SECURITY.md`。

---

Thank you for improving LoadChat. Search existing issues first. For features or protocol changes, open a discussion describing the use case and compatibility impact before implementation.

## Local development

```bash
npm ci
npm run dev
```

Before submitting:

```bash
npm run typecheck
npm run build
```

Never commit `data/`, `.env`, certificates, logs, build artifacts, or real messages/files. New endpoints must enforce room authorization; file endpoints must also validate device tokens. Update `SECURITY.md` when changing security behavior.
