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
   LinkGrab 1.0.2
   Provider Registry
   ========================================================= */

const PROVIDERS = {
  instagram: {
    name: 'Instagram',
    enabled: true,

    matches(url) {
      return String(url)
        .toLowerCase()
        .includes('instagram.com');
    },

    formatMode: 'standard'
  },


  facebook: {
    name: 'Facebook',
    enabled: true,

    matches(url) {
      const u = String(url).toLowerCase();

      return (
        u.includes('facebook.com') ||
        u.includes('fb.watch')
      );
    },

    formatMode: 'standard'
  },


  twitter: {
    name: 'X / Twitter',
    enabled: true,

    matches(url) {
      const u = String(url).toLowerCase();

      return (
        u.includes('twitter.com') ||
        u.includes('x.com')
      );
    },

    formatMode: 'standard'
  },


  vimeo: {
    name: 'Vimeo',
    enabled: true,

    matches(url) {
      return String(url)
        .toLowerCase()
        .includes('vimeo.com');
    },

    formatMode: 'standard'
  },


  soundcloud: {
    name: 'SoundCloud',
    enabled: true,

    matches(url) {
      return String(url)
        .toLowerCase()
        .includes('soundcloud.com');
    },

    formatMode: 'standard'
  },


  /* =======================================================
     Threads
     ======================================================= */

  threads: {
    name: 'Threads',
    enabled: true,

    matches(url) {
      const u = String(url)
        .toLowerCase();

      return (
        u.includes('threads.com')
      );
    },

    formatMode: 'threads'
  },


  /* =======================================================
     TikTok
     ======================================================= */

  tiktok: {
    name: 'TikTok',
    enabled: false,

    matches(url) {
      return String(url)
        .toLowerCase()
        .includes('tiktok.com');
    },

    formatMode: 'standard'
  }
};


/* =========================================================
   Threads URL Normalizer
   =========================================================

   Threads 電腦版網址可能會出現：

   https://www.threads.com/@user/post/ABC123
   https://www.threads.com/@user/post/ABC123/media

   或：

   https://threads.com/@user/post/ABC123
   https://threads.com/@user/post/ABC123/media/

   yt-dlp-threads plugin 主要使用：

   https://www.threads.com/@user/post/ABC123

   因此只針對 Threads 的 /media 結尾進行整理。

   不會影響：
   - /post/ABC123
   - /share/ABC123
   - 其他平台網址

   ========================================================= */

function normalizeThreadsUrl(url) {
  const original =
    String(url || '').trim();

  if (!original) {
    return original;
  }

  try {
    const parsed =
      new URL(original);

    const hostname =
      parsed.hostname.toLowerCase();

    /*
     * 只處理 Threads
     */
    if (
      hostname !== 'threads.com' &&
      hostname !== 'www.threads.com'
    ) {
      return original;
    }

    /*
     * 移除尾端 /
     *
     * 例如：
     * /post/ABC123/
     * →
     * /post/ABC123
     */
    parsed.pathname =
      parsed.pathname.replace(
        /\/+$/,
        ''
      );

    /*
     * 如果是：
     *
     * /@user/post/ABC123/media
     *
     * 就轉成：
     *
     * /@user/post/ABC123
     *
     * 只處理「最後一段」media。
     */
    parsed.pathname =
      parsed.pathname.replace(
        /\/media$/i,
        ''
      );

    /*
     * 再次清除可能留下的 /
     */
    parsed.pathname =
      parsed.pathname.replace(
        /\/+$/,
        ''
      );

    return parsed.toString();

  } catch {
    /*
     * 如果不是正常 URL，
     * 保留原網址，讓後面的驗證處理。
     */
    return original;
  }
}


/* =========================================================
   Normalize URL For Provider
   ========================================================= */

function normalizeUrl(url) {
  const provider =
    getProvider(url);

  if (
    provider &&
    provider.id === 'threads'
  ) {
    return normalizeThreadsUrl(url);
  }

  return String(url || '').trim();
}


/* =========================================================
   Command Runner
   ========================================================= */

function run(
  file,
  args,
  timeout = 10 * 60 * 1000
) {
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
  const u =
    String(url).toLowerCase();

  return (
    u.includes('youtube.com') ||
    u.includes('youtu.be')
  );
}


function platformOf(url) {
  const u =
    String(url).toLowerCase();

  if (isYouTube(u)) {
    return 'YouTube';
  }

  for (const provider of Object.values(PROVIDERS)) {
    try {
      if (provider.matches(u)) {
        return provider.name;
      }
    } catch {
      // Ignore provider detection errors
    }
  }

  return 'Unknown';
}


function getProvider(url) {
  const u =
    String(url).toLowerCase();

  for (
    const [id, provider]
    of Object.entries(PROVIDERS)
  ) {
    try {
      if (provider.matches(u)) {
        return {
          id,
          ...provider
        };
      }
    } catch {
      // Ignore provider detection errors
    }
  }

  return null;
}


function providerIsEnabled(url) {
  const provider =
    getProvider(url);

  return !!(
    provider &&
    provider.enabled
  );
}


/* =========================================================
   Safe Filename
   ========================================================= */

function safeName(name) {
  return String(name || 'LinkGrab')
    .replace(
      /[\\/:*?"<>|\x00-\x1F]/g,
      '_'
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim()
    .slice(0, 100) ||
    'LinkGrab';
}


/* =========================================================
   Output Search
   ========================================================= */

function findOutput(dir, ext) {
  const entries =
    fs.readdirSync(
      dir,
      {
        withFileTypes: true
      }
    );

  const found = [];

  for (const entry of entries) {
    const filePath =
      path.join(
        dir,
        entry.name
      );

    if (entry.isDirectory()) {
      found.push(
        ...findOutput(
          filePath,
          ext
        )
      );

      continue;
    }

    const lower =
      entry.name.toLowerCase();

    if (
      lower.endsWith(ext) &&
      !lower.endsWith('.part') &&
      !lower.endsWith('.ytdl')
    ) {
      found.push(filePath);
    }
  }

  return found;
}


/* =========================================================
   FFprobe
   ========================================================= */

async function getMediaStreams(file) {
  try {
    const { stdout } =
      await run(
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

    const data =
      JSON.parse(stdout);

    return Array.isArray(data.streams)
      ? data.streams
      : [];

  } catch {
    return [];
  }
}


async function mediaHasVideoAndAudio(file) {
  const streams =
    await getMediaStreams(file);

  return (
    streams.some(
      stream =>
        stream.codec_type === 'video'
    ) &&
    streams.some(
      stream =>
        stream.codec_type === 'audio'
    )
  );
}


async function mediaIsCompatibleMp4(file) {
  const streams =
    await getMediaStreams(file);

  const video =
    streams.find(
      stream =>
        stream.codec_type === 'video'
    );

  const audio =
    streams.find(
      stream =>
        stream.codec_type === 'audio'
    );

  if (!video || !audio) {
    return false;
  }

  const videoCompatible =
    String(
      video.codec_name || ''
    ).toLowerCase() === 'h264';

  const audioCompatible =
    String(
      audio.codec_name || ''
    ).toLowerCase() === 'aac';

  return (
    videoCompatible &&
    audioCompatible
  );
}


/* =========================================================
   MP4 Conversion
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

      '-map',
      '0:v:0',

      '-map',
      '0:a:0?',

      '-c:v',
      'libx264',

      '-profile:v',
      'high',

      '-level',
      '4.1',

      '-preset',
      'veryfast',

      '-crf',
      '23',

      '-c:a',
      'aac',

      '-b:a',
      '192k',

      '-ar',
      '48000',

      '-pix_fmt',
      'yuv420p',

      '-movflags',
      '+faststart',

      output
    ],
    12 * 60 * 1000
  );
}


/* =========================================================
   MP4 Validation
   ========================================================= */

async function validateMp4(file) {
  const streams =
    await getMediaStreams(file);

  const video =
    streams.find(
      stream =>
        stream.codec_type === 'video'
    );

  const audio =
    streams.find(
      stream =>
        stream.codec_type === 'audio'
    );

  if (!video) {
    return {
      valid: false,
      reason: '缺少影片軌'
    };
  }

  if (!audio) {
    return {
      valid: false,
      reason: '缺少音訊軌'
    };
  }

  return {
    valid: true
  };
}


/* =========================================================
   Error Responses
   ========================================================= */

function rejectYouTube(res) {
  return res.status(503).json({
    error:
      'YouTube 目前暫不可用，請改用其他支援平台。'
  });
}


function rejectTikTok(res) {
  return res.status(503).json({
    error:
      'TikTok 目前不由 LinkGrab 處理，請使用 TikTok 本身的下載功能。'
  });
}


function rejectDisabledProvider(
  res,
  provider
) {
  return res.status(503).json({
    error:
      `${provider.name} 目前暫不可用。`
  });
}


/* =========================================================
   API Hello
   ========================================================= */

app.get('/api/hello', (req, res) => {
  res.json({
    status: 'ok',

    app: 'LinkGrab',

    version: '1.0.2',

    ytDlp:
      fs.existsSync(YTDLP),

    ffmpeg:
      fs.existsSync(FFMPEG),

    ffprobe:
      fs.existsSync(FFPROBE),

    platforms: {
      youtube: false,

      instagram:
        PROVIDERS.instagram.enabled,

      facebook:
        PROVIDERS.facebook.enabled,

      tiktok:
        PROVIDERS.tiktok.enabled,

      twitter:
        PROVIDERS.twitter.enabled,

      vimeo:
        PROVIDERS.vimeo.enabled,

      soundcloud:
        PROVIDERS.soundcloud.enabled,

      threads:
        PROVIDERS.threads.enabled
    }
  });
});


/* =========================================================
   Health
   ========================================================= */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,

    ytDlp:
      fs.existsSync(YTDLP),

    ffmpeg:
      fs.existsSync(FFMPEG),

    ffprobe:
      fs.existsSync(FFPROBE),

    threads:
      PROVIDERS.threads.enabled
  });
});


/* =========================================================
   SoundCloud Search
   ========================================================= */

app.post('/api/search', async (req, res) => {
  const query =
    String(
      req.body?.query || ''
    ).trim();

  const platform =
    String(
      req.body?.platform || ''
    ).toLowerCase();

  const limit =
    Math.min(
      Math.max(
        Number(req.body?.limit) || 10,
        1
      ),
      10
    );

  if (!query) {
    return res.status(400).json({
      error:
        '請輸入搜尋關鍵字'
    });
  }

  if (!fs.existsSync(YTDLP)) {
    return res.status(500).json({
      error:
        '伺服器尚未準備 yt-dlp'
    });
  }

  if (
    platform.includes('youtube')
  ) {
    return res.status(503).json({
      error:
        'YouTube 目前暫不可用。'
    });
  }

  if (
    platform.includes('soundcloud') ||
    platform.includes('sound')
  ) {
    try {
      const { stdout } =
        await run(
          YTDLP,
          [
            '--flat-playlist',
            '-J',
            '--no-warnings',
            `scsearch${limit}:${query}`
          ],
          90 * 1000
        );

      const data =
        JSON.parse(stdout);

      const results =
        (data.entries || [])
          .filter(Boolean)
          .map(item => ({
            id:
              item.id || '',

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
   INFO / ANALYZE
   ========================================================= */

app.post('/api/info', async (req, res) => {
  const originalUrl =
    String(
      req.body?.url || ''
    ).trim();

  if (!originalUrl) {
    return res.status(400).json({
      error:
        '請輸入網址'
    });
  }

  if (!/^https?:\/\//i.test(originalUrl)) {
    return res.status(400).json({
      error:
        '請輸入有效的網址'
    });
  }

  if (isYouTube(originalUrl)) {
    return rejectYouTube(res);
  }

  const provider =
    getProvider(originalUrl);

  if (!provider) {
    return res.status(400).json({
      error:
        '目前不支援這個網站。'
    });
  }

  if (!provider.enabled) {
    if (provider.name === 'TikTok') {
      return rejectTikTok(res);
    }

    return rejectDisabledProvider(
      res,
      provider
    );
  }

  if (!fs.existsSync(YTDLP)) {
    return res.status(500).json({
      error:
        '伺服器尚未準備 yt-dlp'
    });
  }

  /*
   * Threads：
   *
   * 自動處理：
   *
   * /post/ABC123
   * /post/ABC123/media
   *
   * 最後交給 yt-dlp 的是：
   *
   * /post/ABC123
   */

  const url =
    normalizeUrl(originalUrl);

  try {
    const { stdout } =
      await run(
        YTDLP,
        [
          '-J',

          '--no-warnings',

          '--no-playlist',

          '--retries',
          '2',

          '--fragment-retries',
          '2',

          '--file-access-retries',
          '2',

          '--socket-timeout',
          '30',

          url
        ],
        90 * 1000
      );

    const data =
      JSON.parse(stdout);

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

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

      platform:
        provider.name,

      provider:
        provider.id
    });

  } catch (e) {
    res.status(500).json({
      error:
        `${provider.name} 分析失敗：${e.message}`
    });
  }
});


/* =========================================================
   DOWNLOAD
   ========================================================= */

app.post('/api/download', async (req, res) => {
  const originalUrl =
    String(
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

  if (!originalUrl) {
    return res.status(400).json({
      error:
        '缺少網址'
    });
  }

  if (!/^https?:\/\//i.test(originalUrl)) {
    return res.status(400).json({
      error:
        '網址格式錯誤'
    });
  }

  if (isYouTube(originalUrl)) {
    return rejectYouTube(res);
  }

  const provider =
    getProvider(originalUrl);

  if (!provider) {
    return res.status(400).json({
      error:
        '目前不支援這個網站。'
    });
  }

  if (!provider.enabled) {
    if (provider.name === 'TikTok') {
      return rejectTikTok(res);
    }

    return rejectDisabledProvider(
      res,
      provider
    );
  }

  if (!fs.existsSync(YTDLP)) {
    return res.status(500).json({
      error:
        '伺服器尚未準備 yt-dlp'
    });
  }

  if (!fs.existsSync(FFMPEG)) {
    return res.status(500).json({
      error:
        '伺服器尚未準備 FFmpeg'
    });
  }

  if (!fs.existsSync(FFPROBE)) {
    return res.status(500).json({
      error:
        '伺服器尚未準備 FFprobe'
    });
  }

  /*
   * Threads URL 正規化
   */
  const url =
    normalizeUrl(originalUrl);

  const jobId =
    `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const jobDir =
    path.join(
      DOWNLOADS,
      jobId
    );

  fs.mkdirSync(
    jobDir,
    {
      recursive: true
    }
  );

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

    '--file-access-retries',
    '2',

    '--socket-timeout',
    '30',

    '-o',
    template
  ];


  /* =======================================================
     Format Selection
     ======================================================= */

  if (format === 'mp4') {
    const quality =
      [
        'high',
        'medium',
        'low'
      ].includes(
        String(req.body?.quality)
      )
        ? String(req.body.quality)
        : 'high';


    /*
     * Threads Provider
     *
     * Threads plugin 主要提供
     * progressive / muxed MP4。
     *
     * 因此直接取得 MP4。
     */

    if (
      provider.formatMode === 'threads'
    ) {
      args.push(
        '-f',
        'best[ext=mp4]/best'
      );

    } else {
      const height =
        quality === 'high'
          ? 1080
          : quality === 'medium'
            ? 720
            : 480;

      args.push(
        '-f',
        `bv*[height<=${height}][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=${height}]+ba/b[ext=mp4]/b`,

        '--merge-output-format',
        'mp4'
      );
    }

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


  /* =======================================================
     Execute yt-dlp
     ======================================================= */

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


    /*
     * Threads plugin 可能直接產生
     * 正常的 .mp4 檔案。
     */

    if (!outputs.length) {
      outputs =
        findOutput(
          jobDir,
          '.mp4'
        );
    }


    if (!outputs.length) {
      throw new Error(
        '找不到完成的檔案'
      );
    }


    let target =
      outputs[0];


    /* =====================================================
       MP4 Validation
       ===================================================== */

    if (format === 'mp4') {
      const validation =
        await validateMp4(target);

      if (!validation.valid) {
        throw new Error(
          `MP4 ${validation.reason}`
        );
      }


      const compatible =
        await mediaIsCompatibleMp4(
          target
        );


      /*
       * 如果不是 H.264 + AAC，
       * 重新轉成最相容的 MP4。
       */

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


        const convertedValidation =
          await validateMp4(
            converted
          );

        if (
          !convertedValidation.valid
        ) {
          throw new Error(
            'MP4 轉碼完成，但影片格式檢查失敗'
          );
        }


        const convertedCompatible =
          await mediaIsCompatibleMp4(
            converted
          );

        if (!convertedCompatible) {
          throw new Error(
            'MP4 轉碼完成，但 H.264/AAC 格式檢查失敗'
          );
        }


        target =
          converted;
      }
    }


    const filename =
      `${requestedName}.${format}`;


    res.setHeader(
      'Cache-Control',
      'no-store'
    );

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
        `${provider.name} 下載失敗：${e.message}`
    });
  }
});


/* =========================================================
   Frontend Fallback
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
      `yt-dlp exists: ${fs.existsSync(YTDLP)}`
    );

    console.log(
      `ffmpeg: ${fs.existsSync(FFMPEG)}`
    );

    console.log(
      `ffprobe: ${fs.existsSync(FFPROBE)}`
    );

    console.log(
      `Threads provider: ${PROVIDERS.threads.enabled}`
    );
  }
);
