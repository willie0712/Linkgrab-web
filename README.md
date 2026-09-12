# LinkGrab Web 1.0.2 — Render Native Node

這個版本給 Render Native Node Web Service 使用，不需要 Docker，也不需要 apt-get。

## Render 設定
- Service Type: Web Service
- Runtime: Node
- Build Command: `npm install`
- Start Command: `bash start.sh`
- Health Check Path: `/api/hello`
- Environment Variables: 不需要額外設定

Render 啟動時會自動下載官方 yt-dlp Linux binary，然後啟動 `server.js`。

## 注意
- 不要把個人 cookies 放進 GitHub。
- `bin/yt-dlp` 是 Render 啟動時自動下載，不需要提交。
- `downloads/` 是暫存下載目錄，不需要提交實際檔案。
