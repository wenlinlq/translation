import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import multer from "multer";
import { recognizeSpeech } from "../services/asrRouter.js";
import { isBosConfigured } from "../services/bos.js";
import { translateText } from "../services/mt.js";
import { synthesizeSpeech, TTS_VOICE_OPTIONS } from "../services/tts.js";
import { createTimer } from "../utils/timing.js";
import * as logger from "../utils/logger.js";
import { AUDIO_LIMITS, UPLOAD_HINT_LINES } from "../config/audioLimits.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "../../uploads");
const OUTPUT_DIR = path.join(__dirname, "../../output");

[UPLOAD_DIR, OUTPUT_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-()\u4e00-\u9fa5]/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: AUDIO_LIMITS.maxFileSizeMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".wav", ".mp3", ".m4a", ".aac", ".mp4"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("仅支持 WAV、MP3、M4A 格式"));
    }
  },
});

export const pipelineRouter = express.Router();

async function runMtAndTts(
  originalText,
  sourceLang,
  targetLang,
  stamp,
  speechKey,
  speechSecret,
  mtAppId,
  mtSecret,
  ttsPer,
  timings,
) {
  let t = createTimer();
  logger.log("INFO", "步骤 2/3：机器翻译 (MT)");
  const translatedText = await translateText(
    originalText,
    sourceLang,
    targetLang,
    mtAppId,
    mtSecret,
  );
  timings.mt = t.elapsedMs();
  logger.logTiming("MT 机器翻译", timings.mt);

  const baseName = `result-${stamp}`;
  const resultTxtPath = path.join(OUTPUT_DIR, `${baseName}.txt`);
  const resultContent = [
    "========== 原文（ASR） ==========",
    originalText,
    "",
    "========== 译文（MT） ==========",
    translatedText,
    "",
    `源语言: ${sourceLang}`,
    `目标语言: ${targetLang}`,
    `生成时间: ${new Date().toLocaleString("zh-CN")}`,
    "",
    "========== 各阶段耗时 (ms) ==========",
    ...Object.entries(timings).map(([k, v]) => `${k}: ${v}`),
  ].join("\n");
  fs.writeFileSync(resultTxtPath, resultContent, "utf8");
  logger.log("INFO", "已保存文本结果", resultTxtPath);

  t = createTimer();
  logger.log("INFO", "步骤 3/3：语音合成 (TTS)");
  const ttsPath = path.join(OUTPUT_DIR, `${baseName}-tts.mp3`);
  const ttsResult = await synthesizeSpeech(
    translatedText,
    targetLang,
    ttsPath,
    speechKey,
    speechSecret,
    ttsPer,
  );
  timings.tts = t.elapsedMs();
  logger.logTiming("TTS 语音合成", timings.tts, { per: ttsResult.per });
  logger.log("INFO", "已保存合成音频", ttsPath);

  return {
    originalText,
    translatedText,
    sourceLang,
    targetLang,
    ttsMeta: { per: ttsResult.per, lan: ttsResult.lan },
    files: {
      resultTxt: `/output/${path.basename(resultTxtPath)}`,
      ttsAudio: `/output/${path.basename(ttsPath)}`,
    },
  };
}

pipelineRouter.get("/limits", (_req, res) => {
  res.json({
    limits: AUDIO_LIMITS,
    hints: UPLOAD_HINT_LINES,
    bosConfigured: isBosConfigured(),
    asrMode: isBosConfigured() ? "aasr" : "short",
  });
});

pipelineRouter.get("/voices", (_req, res) => {
  res.json({ voices: TTS_VOICE_OPTIONS });
});

pipelineRouter.post("/process", upload.single("audio"), async (req, res) => {
  const logPath = logger.startSessionLog();
  const pipelineTimer = createTimer();
  const timings = {};

  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "请上传音频文件" });
    }

    const speechKey = process.env.BAIDU_SPEECH_API_KEY;
    const speechSecret = process.env.BAIDU_SPEECH_SECRET_KEY;
    const mtAppId = process.env.BAIDU_MT_APP_ID;
    const mtSecret = process.env.BAIDU_MT_SECRET;

    if (!speechKey || !speechSecret || !mtAppId || !mtSecret) {
      throw new Error("请在 backend/.env 中配置百度语音与翻译密钥");
    }

    if (!isBosConfigured()) {
      logger.log("INFO", "未配置 BOS，将使用短语音识别（≤60秒）");
    }

    const sourceLang = req.body.sourceLang || process.env.SOURCE_LANG || "zh";
    const targetLang = req.body.targetLang || process.env.TARGET_LANG || "en";
    const ttsPer = req.body.ttsPer;
    const stamp = Date.now();

    logger.log("INFO", "收到音频", {
      originalname: req.file.originalname,
      size: req.file.size,
      sizeMb: (req.file.size / 1024 / 1024).toFixed(2),
      asrMode: isBosConfigured() ? "音频文件转写+BOS" : "短语音",
    });

    let t = createTimer();
    logger.log("INFO", "步骤 1/3：语音识别 (ASR)");
    const asr = await recognizeSpeech(
      req.file.path,
      req.file.originalname,
      sourceLang,
      speechKey,
      speechSecret,
    );
    timings.asr = t.elapsedMs();
    if (asr.meta?.timings) {
      timings.bos = asr.meta.timings.bos;
      timings.asrCreate = asr.meta.timings.create;
      timings.asrPoll = asr.meta.timings.poll;
    }
    logger.logTiming("ASR 语音识别（总计）", timings.asr, asr.meta);
    logger.log("INFO", "识别完成", asr.text.slice(0, 200));

    const payload = await runMtAndTts(
      asr.text,
      sourceLang,
      targetLang,
      stamp,
      speechKey,
      speechSecret,
      mtAppId,
      mtSecret,
      ttsPer,
      timings,
    );

    timings.total = pipelineTimer.elapsedMs();
    logger.logTiming("流水线总计", timings.total, timings);

    res.json({
      success: true,
      ...payload,
      asrMeta: asr.meta,
      asrMode: asr.meta?.mode || (isBosConfigured() ? "aasr" : "short"),
      timings,
      logFile: path.basename(logPath),
    });
  } catch (err) {
    timings.total = pipelineTimer.elapsedMs();
    logger.logTiming("流水线失败前已耗时", timings.total);
    logger.log("ERROR", err.message);
    res.status(500).json({ success: false, message: err.message, timings });
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
    }
  }
});

pipelineRouter.post("/reprocess", async (req, res) => {
  const logPath = logger.startSessionLog();
  const pipelineTimer = createTimer();
  const timings = {};

  try {
    const { originalText, sourceLang, targetLang, ttsPer } = req.body || {};
    if (!originalText?.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "请提供修正后的原文" });
    }

    const speechKey = process.env.BAIDU_SPEECH_API_KEY;
    const speechSecret = process.env.BAIDU_SPEECH_SECRET_KEY;
    const mtAppId = process.env.BAIDU_MT_APP_ID;
    const mtSecret = process.env.BAIDU_MT_SECRET;

    if (!speechKey || !speechSecret || !mtAppId || !mtSecret) {
      throw new Error("请在 backend/.env 中配置百度语音与翻译密钥");
    }

    const src = sourceLang || process.env.SOURCE_LANG || "zh";
    const tgt = targetLang || process.env.TARGET_LANG || "en";
    const stamp = Date.now();

    logger.log("INFO", "用户修正原文后重新翻译", originalText.trim());

    const payload = await runMtAndTts(
      originalText.trim(),
      src,
      tgt,
      stamp,
      speechKey,
      speechSecret,
      mtAppId,
      mtSecret,
      ttsPer,
      timings,
    );

    timings.total = pipelineTimer.elapsedMs();
    logger.logTiming("重新翻译流水线总计", timings.total, timings);

    res.json({
      success: true,
      ...payload,
      timings,
      logFile: path.basename(logPath),
    });
  } catch (err) {
    timings.total = pipelineTimer.elapsedMs();
    logger.logTiming("流水线失败前已耗时", timings.total);
    logger.log("ERROR", err.message);
    res.status(500).json({ success: false, message: err.message, timings });
  }
});
