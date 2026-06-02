/**
 * 与百度智能云文档一致的音频限制说明
 * @see https://cloud.baidu.com/doc/SPEECH/s/Jlbxdezuf 短语音识别标准版
 * @see https://cloud.baidu.com/doc/SPEECH/s/qlcirqhz0 产品概述
 */
export const AUDIO_LIMITS = {
  /** 百度短语音识别：单次请求完整录音 ≤60 秒 */
  baiduShortAsrMaxSeconds: 60,
  /** 本服务切分每段时长（须 <60s，留 1 秒余量） */
  chunkSeconds: 59,
  maxFileSizeMb: 50,
  /** 短语音 API 支持格式（百度文档：pcm/wav/amr/m4a） */
  formats: 'WAV、MP3、M4A（将转为 16kHz 单声道）',
  sampleRate: 16000,
  channels: 1,
};

export const UPLOAD_HINT_LINES = [
  `百度「短语音识别」：单次上传录音时长不超过 ${AUDIO_LIMITS.baiduShortAsrMaxSeconds} 秒（官方硬性限制）`,
  `请上传 ≤ ${AUDIO_LIMITS.baiduShortAsrMaxSeconds} 秒的清晰人声；超过后系统会按约 ${AUDIO_LIMITS.chunkSeconds} 秒/段切分，过长仍可能失败（如 3 分钟以上）`,
  `格式：${AUDIO_LIMITS.formats}；采样率 ${AUDIO_LIMITS.sampleRate}Hz、单声道；单文件 ≤ ${AUDIO_LIMITS.maxFileSizeMb}MB`,
  '更长音频需使用百度「音频文件转写」（异步、需公网音频 URL），当前版本未接入',
];
