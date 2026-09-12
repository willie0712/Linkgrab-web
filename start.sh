#!/usr/bin/env bash
set -e

mkdir -p bin downloads

echo "[LinkGrab] Installing yt-dlp..."
curl -L --fail --retry 3 --connect-timeout 15 \
  -o bin/yt-dlp \
  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
chmod +x bin/yt-dlp

echo "[LinkGrab] yt-dlp ready: $(bin/yt-dlp --version)"

echo "[LinkGrab] Starting server on PORT=${PORT:-10000}"
exec node server.js
