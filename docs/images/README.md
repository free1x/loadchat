# Screenshot checklist

Release screenshots must be captured from a fresh demo data directory and must not contain real device names, IP addresses, messages, filenames, QR destinations, access tokens, or personal avatars.

Required files for the bilingual READMEs:

- `home.webp` — desktop home page, demo LAN URL such as `192.168.1.20`.
- `chat.webp` — desktop direct conversation with fictional users and filenames.
- `files.webp` — file center showing fictional local files.
- `preview.webp` — in-app large image preview with explicit download and close controls.
- `mobile.webp` — mobile home layout at a common phone viewport.

Before capture, use a temporary `LOADCHAT_DATA_DIR`, set a documentation-only `LOADCHAT_PUBLIC_URL`, and inspect every visible string. Images should be optimized before committing. Do not reuse screenshots from a real deployment.
