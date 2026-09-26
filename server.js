const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

const PORT = Number(process.env.PORT) || 10000;

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DOWNLOADS = path.join(ROOT, 'downloads');

const YTDLP =
  process.env.YTDLP_PATH ||
  path.join(ROOT, 'bin', 'yt-dlp');

const FFPROBE = '/usr/bin/ffprobe';
const FFMPEG = '/usr/bin/ffmpeg';

fs.mkdirSync(DOWNLOADS, { recursive: true });

app.use(express.json({ limit: '1mb' }));
app.disable('x-powered-by');
app.use(express.static(PUBLIC));

/* =========================================================
   Helpers
========================================================= */

function run(file, args, timeout = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout,
        maxBuffer: 100 * 1024 * 1024
      },
      (err, stdout, stderr) => {
        if (err) {
          const error = new Error(
            (stderr || err.message || '命令執行失敗').trim()
          );

          error.stdout = stdout || '';
          error.stderr = stderr || '';

          reject(error);
          return;
        }

        resolve({
          stdout: stdout || '',
          stderr: stderr || ''
        });
      }
    );
  });
}

function isYouTube(url) {
  const u = String(url).toLowerCase();

  return (
    u.includes('youtube.com') ||
    u.includes('youtu.be')
  );
}

function isThreads(url) {
  const u = String(url).toLowerCase();

  return (
    u.includes('threads.net') ||
    u.includes('threads.com')
  );
}

function platformOf(url) {
  const u = String(url).toLowerCase();

  if (isYouTube(u)) return 'YouTube';

  if (
    u.includes('facebook.com') ||
    u.includes('fb.watch')
  ) {
    return 'Facebook';
  }

  if (u.includes('instagram.com')) {
    return 'Instagram';
  }

  if (isThreads(u)) {
    return 'Threads';
  }

  if (u.includes('soundcloud.com')) {
    return 'SoundCloud';
  }

  if (u.includes('tiktok.com')) {
    return 'TikTok';
  }

  if (
    u.includes('twitter.com') ||
    u.includes('x.com')
  ) {
    return 'X / Twitter';
  }

  if (u.includes('vimeo.com')) {
    return 'Vimeo';
  }

  return 'Unknown';
}

function safeName(name) {
  return String(name || 'LinkGrab')
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'LinkGrab';
}

function findOutput(dir, ext) {
  const files = fs.readdirSync(dir, {
    withFileTypes: true
  });

  const found = [];

  for (const item of files) {
    const p = path.join(dir, item.name);

    if (item.isDirectory()) {
      found.push(...findOutput(p, ext));
    } else if (
      item.name.toLowerCase().endsWith(ext) &&
      !item.name.endsWith('.part')
    ) {
      found.push(p);
    }
  }

  return found;
}

async function mediaHasVideoAndAudio(file) {
  try {
    const { stdout } = await run(
      FFPROBE,
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type',
        '-of',
        'json',
        file
      ],
      30 * 1000
    );

    const streams =
      JSON.parse(stdout).streams || [];

    return (
      streams.some(
        (s) => s.codec_type === 'video'
      ) &&
      streams.some(
        (s) => s.codec_type === 'audio'
      )
    );
  } catch {
    return false;
  }
}

/* =========================================================
   YouTube
========================================================= */

function youtubeError() {
  return new Error(
    'YouTube 目前暫不可用。請改用其他支援平台。'
  );
}

/* =========================================================
   yt-dlp arguments
========================================================= */

function baseYtDlpArgs() {
  return [
    '--no-warnings',
    '--no-playlist'
  ];
}

/*
 * Threads 使用第三方 extractor plugin。
 *
 * YouTube 在目前 Render 環境暫停使用，
 * 因此不再嘗試呼叫 YouTube。
 */
function infoArgs(url) {
  return [
    ...baseYtDlpArgs(),
    '-J',
    url
  ];
}

function downloadBaseArgs(template) {
  return [
    '--no-warnings',
    '--no-playlist',
    '--newline',
    '--retries',
    '2',
    '--fragment-retries',
    '2',
    '-o',
    template
  ];
}

/* =========================================================
   Health
========================================================= */

app.get('/api/hello', (req, res) => {
  res.json({
    status: 'ok',
    app: 'LinkGrab',
    version: '1.0.2',

    ytDlp: fs.existsSync(YTDLP),
    ffmpeg: fs.existsSync(FFMPEG),
    ffprobe: fs.existsSync(FFPROBE),

    platforms: {
      youtube: false,
      instagram: true,
      facebook: true,
      tiktok: true,
      twitter: true,
      vimeo: true,
      soundcloud: true,
      threads: true
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    ytDlp: fs.existsSync(YTDLP),
    ffmpeg: fs.existsSync(FFMPEG),
    ffprobe: fs.existsSync(FFPROBE)
  });
});

/* =========================================================
   Search
========================================================= */

app.post('/api/search', async (req, res) => {
  const query = String(
    req.body?.query || ''
  ).trim();

  const platform = String(
    req.body?.platform || 'YouTube'
  ).toLowerCase();

  const limit = Math.min(
    Math.max(
      Number(req.body?.limit) || 10,
      1
    ),
    10
  );

  if (!query) {
    return res.status(400).json({
      error: '請輸入搜尋關鍵字'
    });
  }

  if (!fs.existsSync(YTDLP)) {
    return res.status(500).json({
      error: '伺服器尚未準備 yt-dlp'
    });
  }

  /*
   * YouTube 搜尋目前停用。
   * SoundCloud 搜尋仍保留。
   */
  if (platform.includes('youtube')) {
    return res.status(503).json({
      error: 'YouTube 目前暫不可用。'
    });
  }

  const prefix =
    platform.includes('sound')
      ? 'scsearch'
      : null;

  if (!prefix) {
    return res.status(400).json({
      error: '目前只有 SoundCloud 搜尋功能。'
    });
  }

  try {
    const { stdout } = await run(
      YTDLP,
      [
        '--flat-playlist',
        '-J',
        '--no-warnings',
        `${prefix}${limit}:${query}`
      ],
      90 * 1000
    );

    const data = JSON.parse(stdout);

    const results = (data.entries || [])
      .filter(Boolean)
      .map((item) => ({
        id: item.id || '',
        url:
          item.webpage_url ||
          item.url ||
          '',
        title:
          item.title ||
          '未命名',
        thumbnail:
          item.thumbnail ||
          '',
        uploader:
          item.uploader ||
          item.channel ||
          '',
        duration:
          item.duration ||
          0
      }));

    res.json({ results });
  } catch (e) {
    res.status(500).json({
      error: `搜尋失敗：${e.message}`
    });
  }
});

/* =========================================================
   Info
========================================================= */

app.post('/api/info', async (req, res) => {
  const url = String(
    req.body?.url || ''
  ).trim();

  if (!url) {
    return res.status(400).json({
      error: '請輸入網址'
    });
  }

  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({
      error: '請輸入有效的網址'
    });
  }

  const platform = platformOf(url);

  /*
   * YouTube 直接拒絕。
   */
  if (platform === 'YouTube') {
    return res.status(503).json({
      error:
        'YouTube 目前暫不可用。請改用其他支援平台。'
    });
  }

  if (!fs.existsSync(YTDLP)) {
    return res.status(500).json({
      error: '伺服器尚未準備 yt-dlp'
    });
  }

  try {
    const { stdout } = await run(
      YTDLP,
      infoArgs(url),
      90 * 1000
    );

    const data = JSON.parse(stdout);

    res.json({
      title:
        data.title ||
        '未命名影片',

      thumbnail:
        data.thumbnail ||
        '',

      duration:
        data.duration ||
        0,

      uploader:
        data.uploader ||
        data.channel ||
        '',

      view_count:
        data.view_count ||
        0,

      like_count:
        data.like_count ||
        0,

      platform
    });
  } catch (e) {
    let errorMessage =
      e?.message ||
      '分析失敗';

    /*
     * Threads plugin / extractor 錯誤
     */
    if (platform === 'Threads') {
      errorMessage =
        `Threads 分析失敗：${errorMessage}`;
    }

    res.status(500).json({
      error: errorMessage
    });
  }
});

/* =========================================================
   Download
========================================================= */

app.post('/api/download', async (req, res) => {
  const url = String(
    req.body?.url || ''
  ).trim();

  const format =
    req.body?.format === 'mp3'
      ? 'mp3'
      : 'mp4';

  const requestedName =
    safeName(
      req.body?.filename ||
      'LinkGrab'
    );

  if (!url) {
    return res.status(400).json({
      error: '缺少網址'
    });
  }

  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({
      error: '網址格式錯誤'
    });
  }

  const platform = platformOf(url);

  /*
   * YouTube 暫時停用。
   */
  if (platform === 'YouTube') {
    return res.status(503).json({
      error:
        'YouTube 目前暫不可用。請改用其他支援平台。'
    });
  }

  if (!fs.existsSync(YTDLP)) {
    return res.status(500).json({
      error:
        '伺服器尚未準備 yt-dlp'
    });
  }

  const jobId =
    `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const jobDir =
    path.join(DOWNLOADS, jobId);

  fs.mkdirSync(jobDir, {
    recursive: true
  });

  const template =
    path.join(
      jobDir,
      `${requestedName}.%(ext)s`
    );

  const args =
    downloadBaseArgs(template);

  /* =====================================================
     MP4
  ===================================================== */

  if (format === 'mp4') {
    const quality =
      ['high', 'medium', 'low'].includes(
        String(req.body?.quality)
      )
        ? String(req.body.quality)
        : 'high';

    const height =
      quality === 'high'
        ? 1080
        : quality === 'medium'
          ? 720
          : 480;

    /*
     * 優先選擇影片＋音訊。
     *
     * Threads plugin 提供的公開 MP4
     * 通常本身已經包含影音。
     *
     * 其他平台則由 yt-dlp + ffmpeg
     * 負責合併。
     */
    args.push(
      '-f',
      `bv*[height<=${height}]+ba/bv*+ba/b[ext=mp4]/b`,
      '--merge-output-format',
      'mp4',
      '--remux-video',
      'mp4'
    );
  }

  /* =====================================================
     MP3
  ===================================================== */

  else {
    args.push(
      '-f',
      'ba/b',
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '0'
    );
  }

  args.push(url);

  try {
    await run(
      YTDLP,
      args,
      12 * 60 * 1000
    );

    const outputs =
      findOutput(
        jobDir,
        `.${format}`
      );

    if (!outputs.length) {
      throw new Error(
        '找不到完成的檔案'
      );
    }

    const target = outputs[0];

    /*
     * MP4 強制確認：
     * 必須同時有 video + audio。
     */
    if (
      format === 'mp4' &&
      !(await mediaHasVideoAndAudio(target))
    ) {
      throw new Error(
        'MP4 缺少影片或音訊軌，無法提供下載'
      );
    }

    const filename =
      `${requestedName}.${format}`;

    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );

    res.setHeader(
      'Content-Type',
      format === 'mp4'
        ? 'video/mp4'
        : 'audio/mpeg'
    );

    res.download(
      target,
      filename,
      () => {
        fs.rm(
          jobDir,
          {
            recursive: true,
            force: true
          },
          () => {}
        );
      }
    );
  } catch (e) {
    fs.rm(
      jobDir,
      {
        recursive: true,
        force: true
      },
      () => {}
    );

    let errorMessage =
      e?.message ||
      '下載失敗';

    if (platform === 'Threads') {
      errorMessage =
        `Threads 下載失敗：${errorMessage}`;
    }

    res.status(500).json({
      error:
        `下載失敗：${errorMessage}`
    });
  }
});

/* =========================================================
   SPA fallback
========================================================= */

app.use((req, res) => {
  res.sendFile(
    path.join(
      PUBLIC,
      'index.html'
    )
  );
});

/* =========================================================
   Start
========================================================= */

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `LinkGrab 1.0.2 listening on port ${PORT}`
    );

    console.log(
      `yt-dlp: ${YTDLP}`
    );

    console.log(
      `ffmpeg: ${fs.existsSync(FFMPEG)}`
    );

    console.log(
      `ffprobe: ${fs.existsSync(FFPROBE)}`
    );
  }
);
