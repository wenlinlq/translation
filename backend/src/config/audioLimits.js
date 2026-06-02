/**
 * 音频限制说明（与百度智能云文档一致）
 * 短语音: https://cloud.baidu.com/doc/SPEECH/s/Jlbxdezuf
 * 音频文件转写: https://cloud.baidu.com/doc/SPEECH/s/Klbxern8v
 */
export const AUDIO_LIMITS = {
  /** 短语音识别单次上限 */
  baiduShortAsrMaxSeconds: 60,
  /** 音频文件转写：单文件最大约 500MB */
  aasrMaxFileSizeMb: 500,
  maxFileSizeMb: 500,
  chunkSeconds: 59,
  formats: 'WAV、MP3、M4A',
  sampleRate: 16000,
};

export const UPLOAD_HINT_LINES = [
  '识别方式：百度「音频文件转写」（需配置 BOS 对象存储，先上传云端再识别）',
  `支持格式：${AUDIO_LIMITS.formats}，16kHz 单声道推荐；单文件 ≤ ${AUDIO_LIMITS.aasrMaxFileSizeMb}MB`,
  '时长：支持数分钟至更长音频（异步转写，请耐心等待）；未配置 BOS 时回退短语音（单次 ≤60 秒）',
  '请在 .env 配置 BOS_ACCESS_KEY_ID、BOS_SECRET_ACCESS_KEY、BOS_BUCKET',
];
