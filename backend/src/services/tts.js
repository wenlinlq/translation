import fs from 'fs';
import { getAccessToken } from './baiduAuth.js';
import { normalizeLang } from './mt.js';

const TTS_LANG = {
  zh: 'zh',
  en: 'en',
  jp: 'jp',
  kor: 'kor',
  fra: 'fra',
  spa: 'spa',
  de: 'de',
  ru: 'ru',
};

function ttsLan(code) {
  return TTS_LANG[normalizeLang(code)] || 'en';
}

/**
 * 百度在线语音合成，保存为 mp3
 */
export async function synthesizeSpeech(text, lang, outputPath, apiKey, secretKey) {
  const token = await getAccessToken(apiKey, secretKey);
  const lan = ttsLan(lang);

  const url = new URL('https://tsn.baidu.com/text2audio');
  url.searchParams.set('tex', text);
  url.searchParams.set('tok', token);
  url.searchParams.set('cuid', 'translation-node-app');
  url.searchParams.set('ctp', '1');
  url.searchParams.set('lan', lan);
  url.searchParams.set('per', '0');
  url.searchParams.set('spd', '5');
  url.searchParams.set('pit', '5');
  url.searchParams.set('vol', '5');
  url.searchParams.set('aue', '3');

  const res = await fetch(url.toString());
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const err = await res.json();
    throw new Error(err.err_msg || err.err_txt || 'TTS 合成失败');
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}
