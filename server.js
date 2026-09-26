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

const FFMPEG = '/usr/bin/ffmpeg';
const FFPROBE = '/usr/bin/ffprobe';

fs.mkdirSync(DOWNLOADS, { recursive: true });

app.use(express.json({ limit: '1mb' }));
app.disable('x-powered-by');
app.use(express.static(PUBLIC));

/* =========================================================
   Command Runner
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

/* =========================================================
   Platform Detection
========================================================= */

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

  if (isYouTube(u)) {
    return 'YouTube';
  }

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

  if (u.includes('soundcloud.com')) {
    return 'SoundCloud';
  }

  return 'Unknown';
}

/* =========================================================
   Filename
========================================================= */

function safeName(name) {
  return String(name || 'LinkGrab')
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'LinkGrab';
}

/* =========================================================
   Find Output
========================================================= */

function findOutput(dir, ext) {
  const entries = fs.readdirSync(dir, {
    withFileTypes: true
  });

  const found = [];

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...findOutput(filePath, ext));
      continue;
    }

    if (
      entry.name.toLowerCase().endsWith(ext) &&
      !entry.name.endsWith('.part')
    ) {
      found.push(filePath);
    }
  }

  return found;
}

/* =========================================================
   Media Information
========================================================= */

async function getMediaStreams(file) {
  try {
    const { stdout } = await run(
      FFPROBE,
      [
        '-v',
        'error',
        '-show_entries',
        'stream=index,codec_type,codec_name,profile,pix_fmt,width,height',
        '-of',
        'json',
        file
      ],
      30 * 1000
    );

    const data = JSON.parse(stdout);

    return Array.isArray(data.streams)
      ? data.streams
      : [];
  } catch {
    return [];
  }
}

async function mediaHasVideoAndAudio(file) {
  const streams = await getMediaStreams(file);

  return (
    streams.some(
      (stream) =>
        stream.codec_type === 'video'
    ) &&
    streams.some(
      (stream) =>
        stream.codec_type === 'audio'
    )
  );
}

/* =========================================================
   MP4 Compatibility
========================================================= */

async function mediaIsCompatibleMp4(file) {
  const streams = await getMediaStreams(file);

  const video = streams.find(
    (stream) =>
      stream.codec_type === 'video'
  );

  const audio = streams.find(
    (stream) =>
      stream.codec_type === 'audio'
  );

  if (!video || !audio) {
    return false;
  }

  /*
   * 目標播放格式：
   *
   * Video: H.264 / AVC
   * Audio: AAC
   *
   * 這是一般手機、Safari、Chrome、
   * Windows 播放器都比較容易支援的組合。
   */
  const videoCompatible =
    String(video.codec_name || '')
      .toLowerCase() === 'h264';

  const audioCompatible =
    String(audio.codec_name || '')
      .toLowerCase() === 'aac';

  return (
    videoCompatible &&
    audioCompatible
  );
}

/* =========================================================
   Convert MP4 to H.264 + AAC
========================================================= */

async function convertToCompatibleMp4(
  input,
  output
) {
  await run(
    FFMPEG,
    [
      '-y',

      '-i',
      input,

      /*
       * H.264
       */
      '-c:v',
      'libx264',

      /*
       * 適合手機及網頁播放
       */
      '-preset',
      'veryfast',

      '-crf',
      '23',

      /*
       * AAC
       */
      '-c:a',
      'aac',

      '-b:a',
      '192k',

      /*
       * MP4 網頁最佳化
       */
      '-movflags',
      '+faststart',

      output
    ],
    12 * 60 * 1000
  );
}

/* =========================================================
   YouTube / Threads Disabled
========================================================= */

function rejectYouTube(res) {
  return res.status(503).json({
    error:
      'YouTube 目前暫不可用，請改用其他支援平台。'
  });
}

function rejectThreads(res) {
  return res.status(503).json({
    error:
      'Threads 目前暫不可用，後端功能尚未完成。'
  });
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
      threads: false
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
    req.body?.platform || ''
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
      error:
        '伺服器尚未準備 yt-dlp'
    });
  }

  /*
   * YouTube 搜尋暫停
   */
  if (platform.includes('youtube')) {
    return res.status(503).json({
      error:
        'YouTube 目前暫不可用。'
    });
  }

  /*
   * SoundCloud 搜尋
   */
  if (
    platform.includes('soundcloud') ||
    platform.includes('sound')
  ) {
    try {
      const { stdout } = await run(
        YTDLP,
        [
          '--flat-playlist',
          '-J',
          '--no-warnings',
          `scsearch${limit}:${query}`
        ],
        90 * 1000
      );

      const data = JSON.parse(stdout);

      const results =
        (data.entries || [])
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

      return res.json({
        results
      });
    } catch (e) {
      return res.status(500).json({
        error:
          `搜尋失敗：${e.message}`
      });
    }
  }

  return res.status(400).json({
    error:
      '目前只有 SoundCloud 搜尋功能。'
  });
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
      error:
        '請輸入有效的網址'
    });
  }

  const platform =
    platformOf(url);

  /*
   * YouTube
   */
  if (platform === 'YouTube') {
    return rejectYouTube(res);
  }

  /*
   * Threads
   */
  if (platform === 'Threads') {
    return rejectThreads(res);
  }

  /*
   * Unknown
   */
  if (platform === 'Unknown') {
    return res.status(400).json({
      error:
        '目前不支援這個網站。'
    });
  }

  if (!fs.existsSync(YTDLP)) {
    return res.status(500).json({
      error:
        '伺服器尚未準備 yt-dlp'
    });
  }

  try {
    const { stdout } = await run(
      YTDLP,
      [
        '-J',
        '--no-warnings',
        '--no-playlist',
        url
      ],
      90 * 1000
    );

    const data =
      JSON.parse(stdout);

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
    res.status(500).json({
      error:
        `分析失敗：${e.message}`
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

  const platform =
    platformOf(url);

  /*
   * YouTube
   */
  if (platform === 'YouTube') {
    return rejectYouTube(res);
  }

  /*
   * Threads
   */
  if (platform === 'Threads') {
    return rejectThreads(res);
  }

  /*
   * Unknown
   */
  if (platform === 'Unknown') {
    return res.status(400).json({
      error:
        '目前不支援這個網站。'
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
    path.join(
      DOWNLOADS,
      jobId
    );

  fs.mkdirSync(jobDir, {
    recursive: true
  });

  const template =
    path.join(
      jobDir,
      `${requestedName}.%(ext)s`
    );

  const args = [
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
     * 優先 H.264 + AAC。
     *
     * 這對 Instagram、
     * Facebook、TikTok、
     * Vimeo 等網頁影片比較友善。
     *
     * 如果平台沒有 H.264/AAC，
     * 才退回一般影片＋音訊。
     */
    args.push(
      '-f',
      `bv*[height<=${height}][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=${height}]+ba/b[ext=mp4]/b`,

      '--merge-output-format',
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

    let outputs =
      findOutput(
        jobDir,
        `.${format}`
      );

    if (!outputs.length) {
      throw new Error(
        '找不到完成的檔案'
      );
    }

    let target =
      outputs[0];

    /* ===================================================
       MP4 Compatibility Check
    =================================================== */

    if (format === 'mp4') {
      const hasVideoAudio =
        await mediaHasVideoAndAudio(
          target
        );

      if (!hasVideoAudio) {
        throw new Error(
          'MP4 缺少影片或音訊軌，無法提供下載'
        );
      }

      /*
       * 如果不是 H.264 + AAC，
       * 使用 FFmpeg 重新編碼。
       *
       * 不只是改副檔名。
       */
      const compatible =
        await mediaIsCompatibleMp4(
          target
        );

      if (!compatible) {
        const converted =
          path.join(
            jobDir,
            `${requestedName}.compatible.mp4`
          );

        await convertToCompatibleMp4(
          target,
          converted
        );

        /*
         * 確認轉碼後真的可用
         */
        const convertedOk =
          await mediaIsCompatibleMp4(
            converted
          );

        if (!convertedOk) {
          throw new Error(
            'MP4 轉碼完成，但影片格式檢查失敗'
          );
        }

        /*
         * 使用轉碼後檔案
         */
        target = converted;
      }
    }

    /* ===================================================
       Response
    =================================================== */

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

    res.status(500).json({
      error:
        `下載失敗：${e.message}`
    });
  }
});

/* =========================================================
   SPA Fallback
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