import fs from 'fs';
import { getAccessToken } from './baiduAuth.js';
import {
  splitWavIfNeeded,
  cleanupChunks,
  getWavDurationSeconds,
} from '../utils/wavSplit.js';
import { AUDIO_LIMITS } from '../config/audioLimits.js';

const CHUNK_SECONDS = AUDIO_LIMITS.chunkSeconds;

const DEV_PID_CHAIN = {
  zh: [1537, 80001, 1936],
  en: [1737, 1537],
  jp: [1937, 1537],
  kor: [1938, 1537],
  yue: [1637, 1537],
};

function getDevPidChain(sourceLang) {
  const lang = (sourceLang || 'zh').toLowerCase();
  const custom = process.env.BAIDU_ASR_DEV_PID;
  const base = DEV_PID_CHAIN[lang] || DEV_PID_CHAIN.zh;
  if (custom) {
    const n = Number(custom);
    return [n, ...base.filter((p) => p !== n)];
  }
  return base;
}

function shouldRetryAsr(errMsg, errNo) {
  const msg = String(errMsg || '');
  return (
    errNo === 6 ||
    errNo === 3302 ||
    errNo === 3308 ||
    errNo === 3309 ||
    errNo === 3310 ||
    /permission|无权限|access data|音频过长|过长/i.test(msg)
  );
}

function mergeSegmentTexts(parts, sourceLang) {
  const joined = parts
    .map((t) => t.trim())
    .filter(Boolean)
    .join(sourceLang === 'zh' ? '' : ' ');
  return joined.trim();
}

async function recognizeOneChunkRaw(wavPath, token, devPid) {
  const audioBuffer = fs.readFileSync(wavPath);
  const maxBytes = 9 * 1024 * 1024;
  if (audioBuffer.length > maxBytes) {
    throw new Error('content len too long');
  }

  const url = new URL('https://vop.baidu.com/server_api');
  url.searchParams.set('dev_pid', String(devPid));
  url.searchParams.set('cuid', 'translation-node-app');
  url.searchParams.set('token', token);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'audio/wav;rate=16000',
      'Content-Length': String(audioBuffer.length),
    },
    body: audioBuffer,
  });

  const data = await res.json();

  if (data.err_no !== 0) {
    const err = new Error(data.err_msg || `ASR 错误码 ${data.err_no}`);
    err.errNo = data.err_no;
    if (shouldRetryAsr(err.message, data.err_no)) {
      err.retryPid = true;
    }
    throw err;
  }

  return {
    text: (data.result || []).join('').trim(),
    devPid,
    endpoint: 'server_api_raw',
  };
}

async function recognizeChunkWithFallback(wavPath, token, sourceLang) {
  const chain = getDevPidChain(sourceLang);
  let lastErr;

  for (const devPid of chain) {
    try {
      return await recognizeOneChunkRaw(wavPath, token, devPid);
    } catch (e) {
      lastErr = e;
      if (e.retryPid) continue;
      throw e;
    }
  }

  throw (
    lastErr ||
    new Error(
      `语音识别失败。百度短语音单次不超过 ${AUDIO_LIMITS.baiduShortAsrMaxSeconds} 秒`
    )
  );
}

/** 百度短语音识别（未配置 BOS 时回退） */
export async function recognizeSpeechShort(wavPath, apiKey, secretKey, sourceLang = 'zh') {
  const token = await getAccessToken(apiKey, secretKey);
  const duration = getWavDurationSeconds(wavPath);

  if (duration > AUDIO_LIMITS.baiduShortAsrMaxSeconds * 5) {
    throw new Error(
      `音频约 ${Math.ceil(duration)} 秒。请配置 BOS 使用「音频文件转写」，或裁剪至 ≤${AUDIO_LIMITS.baiduShortAsrMaxSeconds} 秒`
    );
  }

  const chunks = await splitWavIfNeeded(wavPath, CHUNK_SECONDS);
  const texts = [];
  let usedPid;
  let endpoint;

  try {
    for (const chunk of chunks) {
      const result = await recognizeChunkWithFallback(chunk.path, token, sourceLang);
      if (result.text) texts.push(result.text);
      usedPid = result.devPid;
      endpoint = result.endpoint;
    }
  } finally {
    cleanupChunks(chunks);
  }

  const result = mergeSegmentTexts(texts, sourceLang);
  if (!result) {
    throw new Error('语音识别结果为空');
  }

  return {
    text: result,
    meta: {
      devPid: usedPid,
      endpoint,
      baiduMaxSecPerRequest: AUDIO_LIMITS.baiduShortAsrMaxSeconds,
      segments: chunks.length,
    },
  };
}
