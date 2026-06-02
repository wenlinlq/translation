import path from 'path';
import { getAccessToken } from './baiduAuth.js';
import { uploadAudioForAsr, deleteBosObject, isBosConfigured } from './bos.js';
import { createTimer } from '../utils/timing.js';
import * as logger from '../utils/logger.js';

const CREATE_URL = 'https://aip.baidubce.com/rpc/2.0/aasr/v1/create';
const QUERY_URL = 'https://aip.baidubce.com/rpc/2.0/aasr/v1/query';

const AASR_PID = {
  zh: 80006,
  en: 1737,
  jp: 1937,
  kor: 1938,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveAasrPid(sourceLang) {
  if (process.env.BAIDU_AASR_PID) return Number(process.env.BAIDU_AASR_PID);
  const lang = (sourceLang || 'zh').toLowerCase();
  return AASR_PID[lang] ?? 80006;
}

function formatFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const map = {
    mp3: 'mp3',
    wav: 'wav',
    m4a: 'm4a',
    mp4: 'm4a',
    aac: 'm4a',
    amr: 'amr',
    pcm: 'pcm',
  };
  const format = map[ext];
  if (!format) {
    throw new Error(`百度音频转写不支持格式 .${ext}，请使用 mp3/wav/m4a`);
  }
  return format;
}

function parseTaskResult(taskResult) {
  if (!taskResult) return '';

  if (Array.isArray(taskResult.result)) {
    return taskResult.result.join('').trim();
  }

  if (Array.isArray(taskResult.detailed_result)) {
    return taskResult.detailed_result
      .map((seg) => (Array.isArray(seg.res) ? seg.res.join('') : ''))
      .join('')
      .trim();
  }

  return '';
}

async function pollTaskResult(taskId, token) {
  const maxWaitMs = Number(process.env.AASR_POLL_MAX_MS) || 600_000;
  const intervalMs = Number(process.env.AASR_POLL_INTERVAL_MS) || 3000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    await sleep(intervalMs);

    const url = `${QUERY_URL}?access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_ids: [taskId] }),
    });

    const data = await res.json();

    if (data.error_code) {
      throw new Error(data.error_msg || `查询转写失败 ${data.error_code}`);
    }

    const task = data.tasks_info?.[0];
    if (!task) continue;

    const status = task.task_status;

    if (status === 'Success') {
      const text = parseTaskResult(task.task_result);
      if (!text) {
        throw new Error('转写成功但结果为空');
      }
      return {
        text,
        audioDurationMs: task.task_result?.audio_duration,
        taskId,
      };
    }

    if (status === 'Failure') {
      const tr = task.task_result || {};
      throw new Error(tr.err_msg || '音频转写失败');
    }
  }

  throw new Error(
    `转写等待超时（${Math.round(maxWaitMs / 1000)}s），长音频可能需要更久，可增大 AASR_POLL_MAX_MS`
  );
}

/**
 * 百度「音频文件转写」：BOS 上传 + 异步识别
 */
export async function recognizeSpeechLong(
  localPath,
  originalName,
  sourceLang,
  apiKey,
  secretKey
) {
  if (!isBosConfigured()) {
    throw new Error('请先配置 BOS 对象存储（见 .env.example）');
  }

  const token = await getAccessToken(apiKey, secretKey);
  const format = formatFromPath(localPath);
  const pid = resolveAasrPid(sourceLang);

  let t = createTimer();
  logger.log('INFO', '步骤 1a：上传音频到 BOS');
  const { speechUrl, bucket, key } = await uploadAudioForAsr(localPath, originalName);
  const bosMs = t.elapsedMs();
  logger.logTiming('BOS 上传', bosMs);

  try {
    t = createTimer();
    logger.log('INFO', '步骤 1b：创建音频转写任务', { format, pid });
    const createUrl = `${CREATE_URL}?access_token=${encodeURIComponent(token)}`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        speech_url: speechUrl,
        format,
        pid,
        rate: 16000,
      }),
    });

    const createData = await createRes.json();

    if (createData.error_code) {
      throw new Error(createData.error_msg || `创建转写任务失败 ${createData.error_code}`);
    }

    if (!createData.task_id) {
      throw new Error('创建转写任务失败：未返回 task_id');
    }

    const createMs = t.elapsedMs();
    logger.logTiming('创建转写任务', createMs, { task_id: createData.task_id });

    t = createTimer();
    logger.log('INFO', '步骤 1c：轮询转写结果');
    const result = await pollTaskResult(createData.task_id, token);
    const pollMs = t.elapsedMs();
    logger.logTiming('轮询转写结果', pollMs);

    return {
      text: result.text,
      meta: {
        mode: 'aasr',
        pid,
        format,
        taskId: result.taskId,
        audioDurationSec: result.audioDurationMs
          ? Math.round(result.audioDurationMs / 10) / 100
          : undefined,
        bosKey: key,
        timings: { bos: bosMs, create: createMs, poll: pollMs },
      },
    };
  } finally {
    if (process.env.BOS_DELETE_AFTER_ASR !== '0') {
      await deleteBosObject(bucket, key);
    }
  }
}
