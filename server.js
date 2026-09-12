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
const YTDLP = path.join(ROOT, 'bin', 'yt-dlp');
const FFPROBE = '/usr/bin/ffprobe';

fs.mkdirSync(DOWNLOADS, { recursive: true });
app.use(express.json({ limit: '1mb' }));
app.disable('x-powered-by');
app.use(express.static(PUBLIC));

function run(file, args, timeout = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 100 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '命令執行失敗').trim()));
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
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

function safeName(name) {
  return String(name || 'LinkGrab')
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim().slice(0, 100) || 'LinkGrab';
}

async function mediaHasVideoAndAudio(file) {
  try {
    const { stdout } = await run(FFPROBE, ['-v','error','-show_entries','stream=codec_type','-of','json',file], 30 * 1000);
    const streams = JSON.parse(stdout).streams || [];
    return streams.some(s => s.codec_type === 'video') && streams.some(s => s.codec_type === 'audio');
  } catch { return false; }
}

function findOutput(dir, ext) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  const found = [];
  for (const item of files) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) found.push(...findOutput(p, ext));
    else if (item.name.toLowerCase().endsWith(ext) && !item.name.endsWith('.part')) found.push(p);
  }
  return found;
}

app.get('/api/hello', (req, res) => res.json({ status: 'ok', app: 'LinkGrab', version: '1.0.2' }));

app.post('/api/info', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: '請輸入網址' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: '請輸入有效的網址' });
  if (!fs.existsSync(YTDLP)) return res.status(500).json({ error: '伺服器尚未準備 yt-dlp' });
  try {
    const { stdout } = await run(YTDLP, ['-J', '--no-warnings', '--no-playlist', url], 90 * 1000);
    const data = JSON.parse(stdout);
    res.json({
      title: data.title || '未命名影片', thumbnail: data.thumbnail || '',
      duration: data.duration || 0, uploader: data.uploader || data.channel || '',
      view_count: data.view_count || 0, like_count: data.like_count || 0,
      platform: platformOf(url)
    });
  } catch (e) { res.status(500).json({ error: `分析失敗：${e.message}` }); }
});

app.post('/api/download', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const format = req.body?.format === 'mp3' ? 'mp3' : 'mp4';
  const requestedName = safeName(req.body?.filename || 'LinkGrab');
  if (!url) return res.status(400).json({ error: '缺少網址' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: '網址格式錯誤' });
  if (!fs.existsSync(YTDLP)) return res.status(500).json({ error: '伺服器尚未準備 yt-dlp' });

  const jobId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const jobDir = path.join(DOWNLOADS, jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  const template = path.join(jobDir, `${requestedName}.%(ext)s`);
  const args = ['--no-warnings', '--no-playlist', '--newline', '--retries', '2', '--fragment-retries', '2', '-o', template];

  if (format === 'mp4') {
    const quality = ['high','medium','low'].includes(String(req.body?.quality)) ? String(req.body.quality) : 'high';
    const height = quality === 'high' ? 1080 : quality === 'medium' ? 720 : 480;
    args.push('-f', `bv*[height<=${height}]+ba/bv*+ba/b[ext=mp4]/b`, '--merge-output-format', 'mp4', '--remux-video', 'mp4');
  } else {
    args.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
  }
  args.push(url);

  try {
    await run(YTDLP, args, 12 * 60 * 1000);
    const outputs = findOutput(jobDir, `.${format}`);
    if (!outputs.length) throw new Error('找不到完成的檔案');
    const target = outputs[0];
    if (format === 'mp4' && !(await mediaHasVideoAndAudio(target))) {
      throw new Error('MP4 缺少影片或音訊軌，無法提供下載');
    }
    const filename = `${requestedName}.${format}`;
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Type', format === 'mp4' ? 'video/mp4' : 'audio/mpeg');
    res.download(target, filename, () => fs.rm(jobDir, { recursive: true, force: true }, () => {}));
  } catch (e) {
    fs.rm(jobDir, { recursive: true, force: true }, () => {});
    res.status(500).json({ error: `下載失敗：${e.message}` });
  }
});

app.use((req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`LinkGrab 1.0.2 listening on port ${PORT}`));
