# Changelog

All notable changes are documented here. This project follows semantic versioning.

## [Unreleased]

### Added

- Group administrators can transfer ownership while leaving or dissolve a group for all members.

### Fixed

- Group-management failures are now shown in the interface, and member removal uses an explicit action.

## [1.1.1] - 2026-08-20

### Fixed

- First-time administrator setup now distinguishes localhost bootstrap access from a configured administrator password.
- Password-length and localhost-only failures now show explicit feedback; the settings header can also complete initial setup.
- Administrator and access-password updates are validated by both the browser and server instead of being silently ignored.

## [1.1.0] - 2026-08-19

### Added

- Device approval/blocking and a separate administrator session.
- Optional ECDH/AES-GCM end-to-end encryption for direct text messages over HTTPS.
- Reply, reaction, read receipt, recall, message search, and group administration.
- Upload concurrency/daily/storage/free-space limits and server-side SHA-256 verification.
- Expiring/revocable share links, download-count limits, folder upload, and ZIP batch download.
- Consistent SQLite backups, queued restore, audit logs, log rotation, and status metrics.
- mDNS service announcement plus Windows, systemd, launchd, Docker, and HTTPS setup scripts.
- Dark/system themes, responsive improvements, and bilingual project/security documentation.
- In-app full-size image preview in chat and the file center, with a separate original-file download action.

### Security

- Content Security Policy, HTTP and Socket.IO rate limiting, authenticated resumable chunks, and stricter room/file isolation.
- Repository exclusions for runtime databases, files, secrets, certificates, logs, temporary data, and release artifacts.

### Fixed

- LAN-IP blank page, PowerShell starter parsing, transfer panel overflow, online indicators, message notifications, and composer anchoring.
