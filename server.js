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
const YTDLP = process.env.YTDLP_PATH || path.join(ROOT, 'bin', 'yt-dlp');
const FFPROBE = '/usr/bin/ffprobe';

fs.mkdirSync(DOWNLOADS, { recursive: true });
app.use(express.json({ limit: '1mb' }));
app.disable('x-powered-by');
app.use(express.static(PUBLIC));

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

function youtubeArgs() {
  return [
    '--js-runtimes',
    'node',
    '--extractor-args',
    'youtube:player_client=web_embedded,default'
  ];
}

function platformOf(url) {
  const u = String(url).toLowerCase();

  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'YouTube';
  if (u.includes('facebook.com') || u.includes('fb.watch')) return 'Facebook';
  if (u.includes('instagram.com')) return 'Instagram';
  if (u.includes('soundcloud.com')) return 'SoundCloud';
  if (u.includes('tiktok.com')) return 'TikTok';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'X / Twitter';
  if (u.includes('vimeo.com')) return 'Vimeo';

  return 'Unknown';
}

function isYouTube(url) {
  const u = String(url).toLowerCase();

  return (
    u.includes('youtube.com') ||
    u.includes('youtu.be')
  );
}

function safeName(name) {
  return String(name || 'LinkGrab')
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'LinkGrab';
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

    const streams = JSON.parse(stdout).streams || [];

    return (
      streams.some(s => s.codec_type === 'video') &&
      streams.some(s => s.codec_type === 'audio')
    );
  } catch {
    return false;
  }
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

function youtubeErrorMessage(message) {
  const text = String(message || '');

  if (
    text.includes('Failed to extract any player response') ||
    text.includes('Failed to extract player response')
  ) {
    return (
      'YouTube 目前無法取得影片播放器資料。' +
      '請稍後再試。'
    );
  }

  if (
    text.includes('Sign in to confirm') ||
    text.includes('not a bot') ||
    text.includes('not a robot')
  ) {
    return (
      'YouTube 暫時要求額外驗證，' +
      '目前無法由伺服器直接分析這部影片。'
    );
  }

  return text;
}

app.get('/api/hello', (req, res) => {
  res.json({
    status: 'ok',
    app: 'LinkGrab',
    version: '1.0.2',
    ytDlp: fs.existsSync(YTDLP),
    ffmpeg: fs.existsSync('/usr/bin/ffmpeg'),
    ffprobe: fs.existsSync(FFPROBE)
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    ytDlp: fs.existsSync(YTDLP),
    ffmpeg: fs.existsSync('/usr/bin/ffmpeg'),
    ffprobe: fs.existsSync(FFPROBE)
  });
});

app.post('/api/search', async (req, res) => {
  const query = String(req.body?.query || '').trim();
  const platform = String(
    req.body?.platform || 'YouTube'
  ).toLowerCase();

  const limit = Math.min(
    Math.max(Number(req.body?.limit) || 10, 1),
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

  const prefix = platform.includes('sound')
    ? 'scsearch'
    : 'ytsearch';

  try {
    const args = [
      '--flat-playlist',
      '-J',
      '--no-warnings'
    ];

    if (prefix === 'ytsearch') {
      args.push(...youtubeArgs());
    }

    args.push(`${prefix}${limit}:${query}`);

    const { stdout } = await run(
      YTDLP,
      args,
      90 * 1000
    );

    const data = JSON.parse(stdout);

    const results = (data.entries || [])
      .filter(Boolean)
      .map(item => ({
        id: item.id || '',
        url:
          item.webpage_url ||
          item.url ||
          (
            prefix === 'ytsearch' && item.id
              ? `https://www.youtube.com/watch?v=${item.id}`
              : ''
          ),
        title: item.title || '未命名',
        thumbnail: item.thumbnail || '',
        uploader:
          item.uploader ||
          item.channel ||
          '',
        duration: item.duration || 0
      }));

    res.json({ results });
  } catch (e) {
    console.error('[Search Error]', e);

    res.status(500).json({
      error: `搜尋失敗：${e.message}`
    });
  }
});

app.post('/api/info', async (req, res) => {
  const url = String(req.body?.url || '').trim();

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

  if (!fs.existsSync(YTDLP)) {
    return res.status(500).json({
      error: '伺服器尚未準備 yt-dlp'
    });
  }

  try {
    const args = [
      '-v',
      '-J',
      '--no-warnings',
      '--no-playlist'
    ];

    if (isYouTube(url)) {
      args.push(...youtubeArgs());

      console.log('');
      console.log('========================================');
      console.log('[LinkGrab YouTube DEBUG]');
      console.log('URL:', url);
      console.log('yt-dlp:', YTDLP);
      console.log('Args:', args.join(' '));
      console.log('========================================');
    }

    args.push(url);

    const { stdout, stderr } = await run(
      YTDLP,
      args,
      90 * 1000
    );

    if (isYouTube(url)) {
      console.log('[YouTube stdout]');
      console.log(stdout);
      console.log('[YouTube stderr]');
      console.log(stderr);
      console.log('========================================');
    }

    const data = JSON.parse(stdout);

    res.json({
      title: data.title || '未命名影片',
      thumbnail: data.thumbnail || '',
      duration: data.duration || 0,
      uploader:
        data.uploader ||
        data.channel ||
        '',
      view_count: data.view_count || 0,
      like_count: data.like_count || 0,
      platform: platformOf(url)
    });
  } catch (e) {
    if (isYouTube(url)) {
      console.error('');
      console.error('========================================');
      console.error('[LinkGrab YouTube ERROR]');
      console.error('URL:', url);
      console.error('Message:', e.message);
      console.error('STDOUT:');
      console.error(e.stdout || '(empty)');
      console.error('STDERR:');
      console.error(e.stderr || '(empty)');
      console.error('========================================');
      console.error('');
    }

    const message = isYouTube(url)
      ? youtubeErrorMessage(e.message)
      : e.message;

    res.status(500).json({
      error: `分析失敗：${message}`
    });
  }
});

app.post('/api/download', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const format =
    req.body?.format === 'mp3'
      ? 'mp3'
      : 'mp4';

  const requestedName = safeName(
    req.body?.filename || 'LinkGrab'
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

  if (!fs.existsSync(YTDLP)) {
    return res.status(500).json({
      error: '伺服器尚未準備 yt-dlp'
    });
  }

  const jobId =
    `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const jobDir = path.join(
    DOWNLOADS,
    jobId
  );

  fs.mkdirSync(jobDir, {
    recursive: true
  });

  const template = path.join(
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

  if (isYouTube(url)) {
    args.push(...youtubeArgs());
  }

  if (format === 'mp4') {
    const quality = [
      'high',
      'medium',
      'low'
    ].includes(String(req.body?.quality))
      ? String(req.body.quality)
      : 'high';

    const height =
      quality === 'high'
        ? 1080
        : quality === 'medium'
          ? 720
          : 480;

    args.push(
      '-f',
      `bv*[height<=${height}]+ba/bv*+ba/b[ext=mp4]/b`,
      '--merge-output-format',
      'mp4',
      '--remux-video',
      'mp4'
    );
  } else {
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

    const outputs = findOutput(
      jobDir,
      `.${format}`
    );

    if (!outputs.length) {
      throw new Error('找不到完成的檔案');
    }

    const target = outputs[0];

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

    const message = isYouTube(url)
      ? youtubeErrorMessage(e.message)
      : e.message;

    res.status(500).json({
      error: `下載失敗：${message}`
    });
  }
});

app.use((req, res) => {
  res.sendFile(
    path.join(PUBLIC, 'index.html')
  );
});

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `LinkGrab 1.0.2 listening on port ${PORT}`
    );
  }
);
