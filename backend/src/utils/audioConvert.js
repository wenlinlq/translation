import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import decode from 'audio-decode';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '../../uploads/temp');
const TARGET_RATE = 16000;

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

async function ffmpegAvailable() {
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
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

async function convertWithFfmpeg(inputPath, ext) {
  const outPath = path.join(
    TEMP_DIR,
    `${path.basename(inputPath, ext)}-${Date.now()}.wav`
  );
  await execFileAsync(
    'ffmpeg',
    ['-y', '-i', inputPath, '-ar', String(TARGET_RATE), '-ac', '1', '-f', 'wav', outPath],
    { timeout: 120_000 }
  );
  return outPath;
}

async function convertWithDecoder(inputPath, ext) {
  const buffer = fs.readFileSync(inputPath);
  let audio;
  try {
    audio = await decode(buffer);
  } catch (err) {
    throw new Error(`音频解码失败: ${err.message}`);
  }

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
  if (!['.wav', '.mp3'].includes(ext)) {
    throw new Error('仅支持 WAV 或 MP3');
  }

  if (await ffmpegAvailable()) {
    try {
      return await convertWithFfmpeg(inputPath, ext);
    } catch {
      /* 回退到 JS 解码 */
    }
  }

  return convertWithDecoder(inputPath, ext);
}
