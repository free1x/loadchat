LoadChat Windows 便携包 / Windows Portable Package
=================================================

中文
----
1. 完整解压压缩包，不要直接运行压缩包内文件。
2. 双击 start-portable.cmd。
3. Windows 防火墙询问时，仅允许“专用网络”。
4. 窗口会显示类似 http://192.168.1.20:3210 的地址。
5. 同一 Wi-Fi/局域网内的电脑或手机在浏览器打开该地址。
6. 设备出现在在线列表后即可单聊、群聊或发送文件。

测试期间请保持命令窗口开启，按 Ctrl+C 停止。聊天、设置和文件保存在
本目录 data 文件夹，不会上传云端。复制或公开本包前请删除 data 文件夹。

English
-------
1. Extract the entire archive; do not run files inside the ZIP.
2. Double-click start-portable.cmd.
3. Allow the Windows firewall prompt for Private networks only.
4. Open the displayed address (for example http://192.168.1.20:3210) on
   another browser connected to the same LAN/Wi-Fi.
5. Select the other device to chat or send files.

Keep the terminal open and press Ctrl+C to stop. Messages, settings, and files
stay under the local data directory. Delete data before redistributing a used
copy of the package.

Notes
-----
- localhost always means the current device; other devices must use the LAN IP.
- The package targets 64-bit Windows 10/11 and bundles Node.js.
- Trusted HTTPS is recommended for notifications, PWA APIs, and private-text E2EE.
- Never expose the port directly to the Internet.
