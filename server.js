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

const FFMPEG =
  process.env.FFMPEG_PATH ||
  '/usr/bin/ffmpeg';

const FFPROBE =
  process.env.FFPROBE_PATH ||
  '/usr/bin/ffprobe';

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
      const u = String(url || '').toLowerCase();

      return (
        u.includes('threads.com') ||
        u.includes('threads.net')
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
          error.code = err.code;

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

  for (
    const provider of Object.values(PROVIDERS)
  ) {

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
    const [id, provider] of Object.entries(PROVIDERS)
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
   Threads URL Normalizer
   =========================================================

   通用支援：

   threads.com
   www.threads.com
   threads.net
   www.threads.net

   /@user/post/ID
   /@user/post/ID/media
   /share/CODE/

   不包含任何固定帳號或固定貼文。

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

    if (
      hostname !== 'threads.com' &&
      hostname !== 'www.threads.com' &&
      hostname !== 'threads.net' &&
      hostname !== 'www.threads.net'
    ) {
      return original;
    }


    let pathname =
      parsed.pathname;


    /*
     * 移除尾端多餘 /
     */

    pathname =
      pathname.replace(
        /\/+$/g,
        ''
      );


    /*
     * Threads 貼文可能帶 /media
     *
     * 但 /share/XXXX/ 不會被改掉。
     */

    if (
      /\/media$/i.test(pathname)
    ) {

      pathname =
        pathname.replace(
          /\/media$/i,
          ''
        );

    }


    pathname =
      pathname.replace(
        /\/+$/g,
        ''
      );


    parsed.pathname =
      pathname;


    return parsed.toString();

  } catch {

    return original;

  }

}


/* =========================================================
   Normalize URL
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

    .slice(0, 100)

    || 'LinkGrab';

}


/* =========================================================
   Output Search
   ========================================================= */

function findOutput(dir, ext) {

  if (!fs.existsSync(dir)) {
    return [];
  }

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
   Find Any Completed Media
   ========================================================= */

function findCompletedMedia(dir) {

  if (!fs.existsSync(dir)) {
    return [];
  }

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
        ...findCompletedMedia(filePath)
      );

      continue;

    }


    const lower =
      entry.name.toLowerCase();


    if (
      lower.endsWith('.part') ||
      lower.endsWith('.ytdl') ||
      lower.endsWith('.tmp')
    ) {
      continue;
    }


    let stat;

    try {

      stat =
        fs.statSync(filePath);

    } catch {

      continue;

    }


    if (stat.size <= 0) {
      continue;
    }


    if (
      lower.endsWith('.mp4') ||
      lower.endsWith('.m4v') ||
      lower.endsWith('.webm') ||
      lower.endsWith('.mkv') ||
      lower.endsWith('.mov') ||
      lower.endsWith('.mp3') ||
      lower.endsWith('.m4a') ||
      lower.endsWith('.opus') ||
      lower.endsWith('.aac')
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
   yt-dlp JSON Parser
   ========================================================= */

function parseYtdlpJson(stdout) {

  const text =
    String(stdout || '').trim();


  if (!text) {

    throw new Error(
      'yt-dlp 沒有回傳資料'
    );

  }


  try {

    return JSON.parse(text);

  } catch {


    const lines =
      text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);


    for (
      let i = lines.length - 1;
      i >= 0;
      i--
    ) {

      try {

        return JSON.parse(lines[i]);

      } catch {
        // Continue
      }

    }


    throw new Error(
      '無法解析 yt-dlp 回傳資料'
    );

  }

}


/* =========================================================
   Threads Info
   ========================================================= */

async function getThreadsInfo(url) {

  const normalizedUrl =
    normalizeThreadsUrl(url);


  const { stdout, stderr } =
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

        normalizedUrl
      ],

      90 * 1000
    );


  const data =
    parseYtdlpJson(stdout);


  return {
    data,
    stderr
  };

}


/* =========================================================
   Threads Download
   ========================================================= */

async function downloadThreads({
  url,
  format,
  jobDir,
  template
}) {

  const normalizedUrl =
    normalizeThreadsUrl(url);


  /*
   * MP3
   */

  if (format === 'mp3') {

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

      '-f',
      'best[ext=mp4]/best',

      '-o',
      template,

      '-x',

      '--audio-format',
      'mp3',

      '--audio-quality',
      '0',

      '--print',
      'after_move:filepath',

      normalizedUrl
    ];


    const { stdout } =
      await run(
        YTDLP,
        args,
        12 * 60 * 1000
      );


    let target =
      parsePrintedFilepath(
        stdout,
        jobDir
      );


    if (
      !target ||
      !fs.existsSync(target)
    ) {

      const outputs =
        findOutput(
          jobDir,
          '.mp3'
        );


      if (outputs.length) {
        target = outputs[0];
      }

    }


    if (
      !target ||
      !fs.existsSync(target)
    ) {

      throw new Error(
        'Threads 下載完成，但找不到 yt-dlp 產生的 MP3 檔案'
      );

    }


    return target;

  }


  /*
   * MP4
   */

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

    /*
     * Threads plugin 主要提供 MP4。
     *
     * 先嘗試 MP4，再退回 best。
     */

    '-f',
    'best[ext=mp4]/best',

    '-o',
    template,

    '--print',
    'after_move:filepath',

    normalizedUrl
  ];


  const result =
    await run(
      YTDLP,
      args,
      12 * 60 * 1000
    );


  let target =
    parsePrintedFilepath(
      result.stdout,
      jobDir
    );


  /*
   * 第一層 fallback
   */

  if (
    !target ||
    !fs.existsSync(target)
  ) {

    const outputs =
      findOutput(
        jobDir,
        '.mp4'
      );


    if (outputs.length) {
      target = outputs[0];
    }

  }


  /*
   * 第二層 fallback
   */

  if (
    !target ||
    !fs.existsSync(target)
  ) {

    const outputs =
      findCompletedMedia(
        jobDir
      );


    if (outputs.length) {
      target = outputs[0];
    }

  }


  if (
    !target ||
    !fs.existsSync(target)
  ) {

    const details =
      String(
        result.stderr ||
        result.stdout ||
        ''
      ).trim();


    throw new Error(
      details
        ? `Threads 下載完成，但找不到影片檔案：${details.slice(-1500)}`
        : 'Threads 下載完成，但找不到 yt-dlp 產生的影片檔案'
    );

  }


  return target;

}


/* =========================================================
   Parse yt-dlp after_move:filepath
   ========================================================= */

function parsePrintedFilepath(
  stdout,
  jobDir
) {

  const lines =
    String(stdout || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);


  for (
    let i = lines.length - 1;
    i >= 0;
    i--
  ) {

    const line =
      lines[i];


    if (
      line.includes('[download]') ||
      line.includes('[info]') ||
      line.includes('[Threads]') ||
      line.startsWith('WARNING:')
    ) {
      continue;
    }


    let candidate =
      line;


    if (
      !path.isAbsolute(candidate)
    ) {

      candidate =
        path.resolve(
          jobDir,
          candidate
        );

    }


    if (
      fs.existsSync(candidate)
    ) {

      return candidate;

    }

  }


  return null;

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

    ytDlpPath:
      YTDLP,

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


  if (
    !/^https?:\/\//i.test(originalUrl)
  ) {

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


  const url =
    normalizeUrl(originalUrl);


  try {

    let data;


    /*
     * Threads 專用
     */

    if (
      provider.id === 'threads'
    ) {

      const result =
        await getThreadsInfo(url);

      data =
        result.data;

    }


    /*
     * 一般平台
     */

    else {

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


      data =
        parseYtdlpJson(stdout);

    }


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
        (
          Array.isArray(data.thumbnails) &&
          data.thumbnails.length
            ? data.thumbnails[
                data.thumbnails.length - 1
              ]?.url || ''
            : ''
        ),


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

    console.error(
      `[${provider.name}] analyze error:`,
      e.message
    );


    if (e.stderr) {
      console.error(
        e.stderr.slice(-3000)
      );
    }


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


  if (
    !/^https?:\/\//i.test(originalUrl)
  ) {

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


  try {


    /* =====================================================
       Threads
       ===================================================== */

    if (
      provider.id === 'threads'
    ) {

      let target =
        await downloadThreads({

          url: originalUrl,

          format,

          jobDir,

          template

        });


      /*
       * MP4 相容性
       */

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


      return res.download(
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

    }


    /* =====================================================
       一般平台
       ===================================================== */

    const url =
      normalizeUrl(originalUrl);


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


    /* =====================================================
       Format Selection
       ===================================================== */

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


    /* =====================================================
       Execute yt-dlp
       ===================================================== */

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

    console.error(
      `[${provider.name}] download error:`,
      e.message
    );


    if (e.stderr) {

      console.error(
        e.stderr.slice(-3000)
      );

    }


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
