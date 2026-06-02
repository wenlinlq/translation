import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import multer from 'multer';
import { recognizeSpeech } from '../services/asr.js';
import { translateText } from '../services/mt.js';
import { synthesizeSpeech } from '../services/tts.js';
import { toWav16kMono } from '../utils/audioConvert.js';
import * as logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
const OUTPUT_DIR = path.join(__dirname, '../../output');

[UPLOAD_DIR, OUTPUT_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-()\u4e00-\u9fa5]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.wav', '.mp3', '.m4a', '.aac', '.mp4'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 WAV、MP3、M4A 格式'));
    }
  },
});

export const pipelineRouter = express.Router();

pipelineRouter.post('/process', upload.single('audio'), async (req, res) => {
  const logPath = logger.startSessionLog();
  let tempWav = null;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传音频文件' });
    }

    const speechKey = process.env.BAIDU_SPEECH_API_KEY;
    const speechSecret = process.env.BAIDU_SPEECH_SECRET_KEY;
    const mtAppId = process.env.BAIDU_MT_APP_ID;
    const mtSecret = process.env.BAIDU_MT_SECRET;

    if (!speechKey || !speechSecret || !mtAppId || !mtSecret) {
      throw new Error('请在 backend/.env 中配置百度语音与翻译密钥');
    }

    const sourceLang = req.body.sourceLang || process.env.SOURCE_LANG || 'zh';
    const targetLang = req.body.targetLang || process.env.TARGET_LANG || 'en';
    const stamp = Date.now();
    const baseName = `result-${stamp}`;

    logger.log('INFO', '收到音频', {
      originalname: req.file.originalname,
      path: req.file.path,
      size: req.file.size,
    });

    logger.log('INFO', '步骤 1/3：语音识别 (ASR)');
    tempWav = await toWav16kMono(req.file.path);
    const originalText = await recognizeSpeech(tempWav, speechKey, speechSecret);
    logger.log('INFO', '识别完成', originalText);

    logger.log('INFO', '步骤 2/3：机器翻译 (MT)');
    const translatedText = await translateText(
      originalText,
      sourceLang,
      targetLang,
      mtAppId,
      mtSecret
    );
    logger.log('INFO', '翻译完成', translatedText);

    const resultTxtPath = path.join(OUTPUT_DIR, `${baseName}.txt`);
    const resultContent = [
      '========== 原文（ASR） ==========',
      originalText,
      '',
      '========== 译文（MT） ==========',
      translatedText,
      '',
      `源语言: ${sourceLang}`,
      `目标语言: ${targetLang}`,
      `生成时间: ${new Date().toLocaleString('zh-CN')}`,
    ].join('\n');
    fs.writeFileSync(resultTxtPath, resultContent, 'utf8');
    logger.log('INFO', '已保存文本结果', resultTxtPath);

    logger.log('INFO', '步骤 3/3：语音合成 (TTS)');
    const ttsPath = path.join(OUTPUT_DIR, `${baseName}-tts.mp3`);
    await synthesizeSpeech(translatedText, targetLang, ttsPath, speechKey, speechSecret);
    logger.log('INFO', '已保存合成音频', ttsPath);

    logger.log('INFO', '流水线完成');

    res.json({
      success: true,
      originalText,
      translatedText,
      sourceLang,
      targetLang,
      files: {
        resultTxt: `/output/${path.basename(resultTxtPath)}`,
        ttsAudio: `/output/${path.basename(ttsPath)}`,
      },
      logFile: path.basename(logPath),
    });
  } catch (err) {
    logger.log('ERROR', err.message);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
    }
    if (tempWav && tempWav !== req.file?.path && fs.existsSync(tempWav)) {
      try {
        fs.unlinkSync(tempWav);
      } catch {
        /* ignore */
      }
    }
  }
});
