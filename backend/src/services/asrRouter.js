import { isBosConfigured } from './bos.js';
import { recognizeSpeechLong } from './asrLong.js';
import { recognizeSpeechShort } from './asrShort.js';
import { toWav16kMono } from '../utils/audioConvert.js';
import { getWavDurationSeconds } from '../utils/wavSplit.js';

/**
 * 统一 ASR 入口：已配置 BOS 时用「音频文件转写」，否则回退短语音
 */
export async function recognizeSpeech(
  localPath,
  originalName,
  sourceLang,
  apiKey,
  secretKey
) {
  if (isBosConfigured()) {
    return recognizeSpeechLong(
      localPath,
      originalName,
      sourceLang,
      apiKey,
      secretKey
    );
  }

  const wavPath = await toWav16kMono(localPath);
  const shouldCleanup = wavPath !== localPath;
  try {
    const result = await recognizeSpeechShort(
      wavPath,
      apiKey,
      secretKey,
      sourceLang
    );
    return {
      ...result,
      meta: {
        ...result.meta,
        mode: 'short',
        audioDurationSec: getWavDurationSeconds(wavPath),
      },
    };
  } finally {
    if (shouldCleanup) {
      try {
        const fs = await import('fs');
        if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
      } catch {
        /* ignore */
      }
    }
  }
}
