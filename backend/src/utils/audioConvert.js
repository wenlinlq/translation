import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import getType from 'audio-type';
import decode from 'audio-decode';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '../../uploads/temp');
const TARGET_RATE = 16000;

const ALLOWED_EXT = ['.wav', '.mp3', '.m4a', '.aac', '.mp4'];
const FFMPEG_FIRST_TYPES = new Set(['m4a', 'aac', 'mp4', 'webm', 'amr', 'wma']);

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

let cachedFfmpegPath;

export async function resolveFfmpegPath() {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath;

  try {
    const mod = await import('@ffmpeg-installer/ffmpeg');
    const bin = mod.default?.path || mod.path;
    if (bin && fs.existsSync(bin)) {
      cachedFfmpegPath = bin;
      return bin;
    }
  } catch {
    /* 未安装 @ffmpeg-installer/ffmpeg */
  }

  const winPaths = [
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
  ];
  for (const p of winPaths) {
    if (fs.existsSync(p)) {
      cachedFfmpegPath = p;
      return p;
    }
  }

  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
    cachedFfmpegPath = 'ffmpeg';
    return 'ffmpeg';
  } catch {
    cachedFfmpegPath = null;
    return null;
  }
}

function mixToMono(audio) {
  const n = audio.numberOfChannels;
  if (n === 1) return audio.getChannelData(0);
  const len = audio.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < n; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += ch[i] / n;
  }
  return mono;
}

function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const newLen = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const out = new Float32Array(newLen);
  const step = fromRate / toRate;
  for (let i = 0; i < newLen; i++) {
    const pos = i * step;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = samples[idx] ?? 0;
    const b = samples[Math.min(idx + 1, samples.length - 1)] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function writeWav(filePath, samples, sampleRate) {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    buffer.writeInt16LE(Math.round(val), 44 + i * 2);
  }

  fs.writeFileSync(filePath, buffer);
}

function pcmToAudioLike({ channelData, sampleRate }) {
  const length = channelData[0]?.length ?? 0;
  return {
    sampleRate,
    numberOfChannels: channelData.length,
    length,
    getChannelData: (i) => channelData[i],
  };
}

function formatHint(detected, ext) {
  if (detected && detected !== ext.replace('.', '')) {
    return `（扩展名 ${ext}，实际格式 ${detected}）`;
  }
  return '';
}

async function decodeAudioBuffer(buffer, detected) {
  const uint8 = new Uint8Array(buffer);

  if (!detected) {
    throw new Error('无法识别音频格式');
  }

  if (FFMPEG_FIRST_TYPES.has(detected)) {
    throw new Error(
      `当前格式 ${detected} 需 ffmpeg 转换，请在 backend 目录执行: npm install，或安装系统 ffmpeg`
    );
  }

  try {
    return await decode(uint8);
  } catch (err) {
    throw new Error(`音频解码失败: ${err.message}`);
  }
}

async function convertWithFfmpeg(inputPath, ext, ffmpegBin) {
  const outPath = path.join(
    TEMP_DIR,
    `${path.basename(inputPath, ext)}-${Date.now()}.wav`
  );
  await execFileAsync(
    ffmpegBin,
    ['-y', '-i', inputPath, '-ar', String(TARGET_RATE), '-ac', '1', '-f', 'wav', outPath],
    { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 }
  );
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 44) {
    throw new Error('ffmpeg 未生成有效 WAV 文件');
  }
  return outPath;
}

async function convertWithDecoder(inputPath, ext, detected) {
  const buffer = fs.readFileSync(inputPath);
  const audio = await decodeAudioBuffer(buffer, detected);

  let mono = mixToMono(audio);
  mono = resample(mono, audio.sampleRate, TARGET_RATE);

  const outPath = path.join(
    TEMP_DIR,
    `${path.basename(inputPath, ext)}-${Date.now()}.wav`
  );
  writeWav(outPath, mono, TARGET_RATE);
  return outPath;
}

/**
 * 转为百度短语音识别要求的 16kHz 单声道 WAV
 */
export async function toWav16kMono(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    throw new Error('仅支持 WAV、MP3、M4A、AAC 格式');
  }

  const buffer = fs.readFileSync(inputPath);
  const detected = getType(new Uint8Array(buffer));
  const hint = formatHint(detected, ext);
  const ffmpegBin = await resolveFfmpegPath();
  const useFfmpegFirst =
    ffmpegBin && (FFMPEG_FIRST_TYPES.has(detected) || detected === 'mp3' || ext !== '.wav');

  if (useFfmpegFirst) {
    try {
      return await convertWithFfmpeg(inputPath, ext, ffmpegBin);
    } catch (err) {
      if (FFMPEG_FIRST_TYPES.has(detected)) {
        throw new Error(`M4A/AAC 转换失败${hint}: ${err.message}`);
      }
      /* mp3 等可回退 JS 解码 */
    }
  }

  try {
    return await convertWithDecoder(inputPath, ext, detected);
  } catch (err) {
    if (ffmpegBin && !useFfmpegFirst) {
      try {
        return await convertWithFfmpeg(inputPath, ext, ffmpegBin);
      } catch (ffErr) {
        throw new Error(`${err.message}${hint}；ffmpeg 回退也失败: ${ffErr.message}`);
      }
    }
    throw new Error(`${err.message}${hint}`);
  }
}
