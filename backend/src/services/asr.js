import fs from 'fs';
import { getAccessToken } from './baiduAuth.js';
import {
  splitWavIfNeeded,
  cleanupChunks,
  getWavDurationSeconds,
} from '../utils/wavSplit.js';

/** 每段最长秒数（避免 content len too long） */
const CHUNK_SECONDS = Number(process.env.BAIDU_ASR_CHUNK_SEC) || 25;

/** 各语言 dev_pid 回退链（优先通用模型，无权限时自动降级） */
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
    /permission|无权限|access data/i.test(msg)
  );
}

function mergeSegmentTexts(parts, sourceLang) {
  const joined = parts
    .map((t) => t.trim())
    .filter(Boolean)
    .join(sourceLang === 'zh' ? '' : ' ');
  return joined.trim();
}

async function recognizeOneChunk(wavPath, token, devPid, usePro) {
  const audioBuffer = fs.readFileSync(wavPath);
  const maxBytes = 900 * 1024;
  if (audioBuffer.length > maxBytes) {
    throw new Error('content len too long');
  }

  const tryEndpoints = usePro
    ? [
        { url: 'https://vop.baidu.com/pro_api', pro: true },
        { url: 'https://vop.baidu.com/server_api', pro: false },
      ]
    : [{ url: 'https://vop.baidu.com/server_api', pro: false }];

  let lastError = 'ASR 失败';

  for (const { url, pro } of tryEndpoints) {
    const body = {
      format: 'wav',
      rate: 16000,
      channel: 1,
      cuid: 'translation-node-app',
      token,
      dev_pid: devPid,
      speech: audioBuffer.toString('base64'),
      len: audioBuffer.length,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (data.err_no === 0) {
      return {
        text: (data.result || []).join('').trim(),
        devPid,
        endpoint: pro ? 'pro_api' : 'server_api',
      };
    }

    lastError = data.err_msg || `ASR 错误码 ${data.err_no}`;

    if (shouldRetryAsr(lastError, data.err_no)) {
      throw Object.assign(new Error(lastError), { retryPid: true, errNo: data.err_no });
    }

    if (pro && data.err_no === 3302) continue;
    throw new Error(lastError);
  }

  throw new Error(lastError);
}

async function recognizeChunkWithFallback(wavPath, token, sourceLang) {
  const chain = getDevPidChain(sourceLang);
  const usePro = process.env.BAIDU_ASR_USE_PRO === '1';
  let lastErr;

  for (const devPid of chain) {
    try {
      return await recognizeOneChunk(wavPath, token, devPid, usePro);
    } catch (e) {
      lastErr = e;
      if (e.retryPid || /content len too long/i.test(e.message)) {
        if (e.retryPid) continue;
        throw e;
      }
      throw e;
    }
  }

  throw lastErr || new Error('语音识别失败，请检查百度控制台是否开通对应 ASR 模型');
}

/**
 * 百度语音识别（自动分段 + 模型无权限时回退）
 */
export async function recognizeSpeech(wavPath, apiKey, secretKey, sourceLang = 'zh') {
  const token = await getAccessToken(apiKey, secretKey);
  const duration = getWavDurationSeconds(wavPath);

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
    throw new Error('语音识别结果为空，请检查音频是否清晰且为有效语音');
  }

  return {
    text: result,
    meta: {
      devPid: usedPid,
      endpoint,
      durationSec: Math.round(duration * 10) / 10,
      segments: chunks.length,
      chunkSec: CHUNK_SECONDS,
    },
  };
}
