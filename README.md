# LinkGrab Web 1.0.2 — Render Docker Edition

Render 專用版本。使用 Docker 建置，因此不需要在 Render 的 Build Command 裡執行 apt-get。

## GitHub

把整個專案上傳到 GitHub，包含：

- `Dockerfile`
- `render.yaml`
- `server.js`
- `package.json`
- `public/`
- `.dockerignore`
- `.gitignore`

`bin/` 和 `downloads/` 可以保留空資料夾；Docker build 會自己準備 yt-dlp 與 FFmpeg。

## Render

建立 **Web Service**，Runtime 選 **Docker**。

如果 Render 讀取 `render.yaml`，設定會自動使用 Dockerfile。

如果是手動設定：

- Runtime / Language: Docker
- Dockerfile Path: `./Dockerfile`
- Docker Context: `.`
- 不需要 Build Command
- 不需要 Environment Variables
- Docker Command 留空，使用 Dockerfile 的 CMD

## 本版本提供

- 現代化 PC Web UI
- URL 分析
- YouTube / Facebook / Instagram / SoundCloud / TikTok / X / Vimeo
- MP4 / MP3
- Node.js + Express
- yt-dlp
- FFmpeg / FFprobe

注意：Render 免費方案的 CPU、RAM、暫存磁碟、執行時間與流量都有平台限制，不適合大量並行大型下載。公開服務也應限制濫用與不當內容。
