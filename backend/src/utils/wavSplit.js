import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { resolveFfmpegPath } from './audioConvert.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHUNK_DIR = path.join(__dirname, '../../uploads/chunks');

/** 百度短语音建议 ≤25 秒/段，避免 content len too long */
export const ASR_CHUNK_SECONDS = 25;

const MAX_WAV_BYTES = 900 * 1024;

export function getWavDurationSeconds(wavPath) {
  const fd = fs.openSync(wavPath, 'r');
  try {
    const hdr = Buffer.alloc(44);
    fs.readSync(fd, hdr, 0, 44, 0);
    if (hdr.toString('ascii', 0, 4) !== 'RIFF') return 0;
    const byteRate = hdr.readUInt32LE(28);
    const dataSize = hdr.readUInt32LE(40);
    if (byteRate > 0) return dataSize / byteRate;
    return 0;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 将长 WAV 切成多段（用于超过 60 秒的识别）
 */
export async function splitWavIfNeeded(wavPath, maxSeconds = ASR_CHUNK_SECONDS) {
  const duration = getWavDurationSeconds(wavPath);
  const fileSize = fs.statSync(wavPath).size;
  const needSplit =
    duration > maxSeconds + 2 || fileSize > MAX_WAV_BYTES;

  if (!needSplit) {
    return [{ path: wavPath, index: 0, cleanup: false }];
  }

  const ffmpegBin = await resolveFfmpegPath();
  if (!ffmpegBin) {
    throw new Error('音频超过 60 秒，需安装 ffmpeg 以分段识别');
  }

  if (!fs.existsSync(CHUNK_DIR)) {
    fs.mkdirSync(CHUNK_DIR, { recursive: true });
  }

  const base = path.basename(wavPath, path.extname(wavPath));
  const chunkPaths = [];
  let start = 0;
  let index = 0;

  while (start < duration - 0.5) {
    const out = path.join(CHUNK_DIR, `${base}-chunk-${Date.now()}-${index}.wav`);
    const len = Math.min(maxSeconds, duration - start);
    await execFileAsync(ffmpegBin, [
      '-y',
      '-i',
      wavPath,
      '-ss',
      String(start),
      '-t',
      String(len),
      '-ar',
      '16000',
      '-ac',
      '1',
      '-f',
      'wav',
      out,
    ], { timeout: 120_000 });
    chunkPaths.push({ path: out, index, cleanup: true });
    start += maxSeconds;
    index += 1;
  }

  return chunkPaths;
}

export function cleanupChunks(chunks) {
  for (const c of chunks) {
    if (c.cleanup && c.path && fs.existsSync(c.path)) {
      try {
        fs.unlinkSync(c.path);
      } catch {
        /* ignore */
      }
    }
  }
}
