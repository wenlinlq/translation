import { buildMtSign } from './baiduAuth.js';

const LANG_MAP = {
  zh: 'zh',
  en: 'en',
  jp: 'jp',
  kor: 'kor',
  fra: 'fra',
  spa: 'spa',
  de: 'de',
  ru: 'ru',
};

export function normalizeLang(code) {
  return LANG_MAP[code] || code;
}

/**
 * 百度通用翻译 API
 */
export async function translateText(text, from, to, appId, secret) {
  const fromLang = normalizeLang(from);
  const toLang = normalizeLang(to);
  const salt = String(Date.now());
  const sign = buildMtSign(appId, text, salt, secret);

  const url = new URL('https://fanyi-api.baidu.com/api/trans/vip/translate');
  url.searchParams.set('q', text);
  url.searchParams.set('from', fromLang);
  url.searchParams.set('to', toLang);
  url.searchParams.set('appid', appId);
  url.searchParams.set('salt', salt);
  url.searchParams.set('sign', sign);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.error_code) {
    throw new Error(data.error_msg || `翻译错误 ${data.error_code}`);
  }

  const dst = (data.trans_result || []).map((item) => item.dst).join('\n').trim();
  if (!dst) {
    throw new Error('翻译结果为空');
  }

  return dst;
}
