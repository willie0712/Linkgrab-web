FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=10000

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/bin /app/downloads

COPY package*.json ./
RUN npm install --omit=dev

RUN curl -L --fail --retry 3 -o /app/bin/yt-dlp \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
    && chmod +x /app/bin/yt-dlp

COPY . .

RUN chmod +x /app/bin/yt-dlp \
    && mkdir -p /app/downloads

EXPOSE 10000

CMD ["node", "server.js"]
