import fs from "fs";
import { getAccessToken } from "./baiduAuth.js";
import { normalizeLang } from "./mt.js";

const TTS_LANG = {
  zh: "zh",
  en: "en",
  jp: "jp",
  kor: "kor",
  fra: "fra",
  spa: "spa",
  de: "de",
  ru: "ru",
};

/** 默认发音人：精品/臻品/大模型（比基础 per=0 更自然） */
const DEFAULT_PER_BY_LANG = {
  zh: 5118,
  en: 4105,
  jp: 5118,
  kor: 5118,
  fra: 4105,
  spa: 4105,
  de: 4105,
  ru: 4105,
};

/** 若账号未开通高阶音库，依次回退 */
const FALLBACK_PER_CHAIN = [5118, 5003, 4194, 3, 1, 0];

export const TTS_VOICE_OPTIONS = [
  { id: 5118, label: "度小鹿（精品女声，推荐）", langs: ["zh", "jp", "kor"] },
  { id: 5003, label: "度逍遥（精品男声）", langs: ["zh"] },
  { id: 4194, label: "度嫣然（大模型女声）", langs: ["zh"] },
  { id: 4193, label: "度泽言（大模型男声）", langs: ["zh"] },
  { id: 4119, label: "度小鹿（臻品女声）", langs: ["zh"] },
  {
    id: 4105,
    label: "度灵儿（臻品，英语推荐）",
    langs: ["en", "fra", "de", "spa"],
  },
  { id: 4149, label: "度星河（臻品男声）", langs: ["zh", "en"] },
  { id: 3, label: "度逍遥（基础情感男声）", langs: ["zh"] },
  { id: 4, label: "度丫丫（基础情感女声）", langs: ["zh"] },
  { id: 0, label: "度小美（基础女声）", langs: ["zh", "en"] },
];

function ttsLan(code) {
  return TTS_LANG[normalizeLang(code)] || "en";
}

export function resolveTtsPer(lang, override) {
  if (override !== undefined && override !== null && override !== "") {
    return Number(override);
  }
  if (process.env.BAIDU_TTS_PER) {
    return Number(process.env.BAIDU_TTS_PER);
  }
  const key = normalizeLang(lang);
  return DEFAULT_PER_BY_LANG[key] ?? 5118;
}

function buildTtsUrl(text, token, lan, per, options = {}) {
  const url = new URL("https://tsn.baidu.com/text2audio");
  url.searchParams.set("tex", text);
  url.searchParams.set("tok", token);
  url.searchParams.set("cuid", "translation-node-app");
  url.searchParams.set("ctp", "1");
  url.searchParams.set("lan", lan);
  url.searchParams.set("per", String(per));
  url.searchParams.set(
    "spd",
    String(options.spd ?? process.env.BAIDU_TTS_SPD ?? 5),
  );
  url.searchParams.set(
    "pit",
    String(options.pit ?? process.env.BAIDU_TTS_PIT ?? 5),
  );
  url.searchParams.set(
    "vol",
    String(options.vol ?? process.env.BAIDU_TTS_VOL ?? 8),
  );
  url.searchParams.set("aue", "3");
  return url;
}

async function fetchTtsAudio(url) {
  const res = await fetch(url.toString());
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const err = await res.json();
    const msg = err.err_msg || err.err_txt || "TTS 合成失败";
    const code = err.err_no ?? err.err_subcode;
    return { ok: false, message: msg, code };
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return { ok: true, buffer };
}

/**
 * 百度在线语音合成，保存为 mp3
 */
export async function synthesizeSpeech(
  text,
  lang,
  outputPath,
  apiKey,
  secretKey,
  ttsPer,
) {
  const token = await getAccessToken(apiKey, secretKey);
  const lan = ttsLan(lang);
  const preferred = resolveTtsPer(lang, ttsPer);

  const tryOrder = [
    preferred,
    ...FALLBACK_PER_CHAIN.filter((p) => p !== preferred),
  ];

  let lastError = "TTS 合成失败";

  for (const per of tryOrder) {
    const url = buildTtsUrl(text, token, lan, per);
    const result = await fetchTtsAudio(url);

    if (result.ok) {
      fs.writeFileSync(outputPath, result.buffer);
      return { path: outputPath, per, lan };
    }

    lastError = result.message;
    const needFallback =
      /per|发音|音库|鉴权|invalid|不支持|未开通|无权限/i.test(lastError) ||
      result.code === 502 ||
      result.code === 503;
    if (!needFallback) {
      throw new Error(lastError);
    }
  }

  throw new Error(
    `${lastError}（可尝试在 .env 设置 BAIDU_TTS_PER=0 使用基础音库）`,
  );
}
