import fs from 'fs';
import { getAccessToken } from './baiduAuth.js';

/**
 * 百度短语音识别（上传本地 wav/pcm，mp3 需先转换）
 */
export async function recognizeSpeech(wavPath, apiKey, secretKey) {
  const token = await getAccessToken(apiKey, secretKey);
  const audioBuffer = fs.readFileSync(wavPath);

  const body = {
    format: 'wav',
    rate: 16000,
    channel: 1,
    cuid: 'translation-node-app',
    token,
    speech: audioBuffer.toString('base64'),
    len: audioBuffer.length,
  };

  const res = await fetch('https://vop.baidu.com/server_api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (data.err_no !== 0) {
    throw new Error(data.err_msg || `ASR 错误码 ${data.err_no}`);
  }

  const text = (data.result || []).join('').trim();
  if (!text) {
    throw new Error('语音识别结果为空，请检查音频是否清晰且为有效语音');
  }

  return text;
}
