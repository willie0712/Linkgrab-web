# LinkGrab Web 1.0.2 — Render Edition

這個版本是給 Render 部署的 Node.js Web 版，不需要 Electron、Windows `.exe`。

## 部署
1. 把整個資料夾放到 GitHub repository。
2. Render → New → Web Service → 選 GitHub repository。
3. Runtime: Node。
4. Build Command: `apt-get update && apt-get install -y ffmpeg && npm install && mkdir -p bin && curl -L --fail -o bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp && chmod +x bin/yt-dlp`
5. Start Command: `node server.js`
6. Render 會使用 `PORT`。

`render.yaml` 已經包含上述設定；若使用 Blueprint，可以直接建立服務。

注意：Render 免費方案的資源、睡眠、頻寬與暫存磁碟限制可能影響大型或長時間下載。這是 Web 服務的技術限制，不是 LinkGrab 前端問題。
