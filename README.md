# 音频翻译应用

通过本地 WAV/MP3 音频，依次调用百度智能云 **语音识别 (ASR)**、**机器翻译 (MT)**、**语音合成 (TTS)**，在界面展示原文与译文，并保存文本结果与合成音频。

## 技术栈

| 层级 | 说明 |
|------|------|
| 后端 | Node.js + Express |
| 前端 | 静态页面（`backend/public`），也可扩展 uni-app |
| 云服务 | 百度智能云 ASR / 通用翻译 / TTS |

## 快速开始

### 1. 百度智能云密钥

1. 登录 [百度智能云控制台](https://console.bce.baidu.com/)
2. **语音技术** 创建应用，获取 `API Key`、`Secret Key`（用于 ASR、TTS）
3. **机器翻译** 创建应用，获取 `APP ID`、`密钥`（用于 MT）

### 2. 配置环境变量

```bash
cd backend
copy .env.example .env
```

编辑 `backend/.env`，填入上述密钥。

### 3. 安装并启动

```bash
cd backend
npm install
npm start
```

浏览器打开：**http://localhost:3000**

### 4. 使用流程

1. 点击选择本地 **WAV** 或 **MP3** 文件  
2. 选择源语言、目标语言  
3. 点击「开始处理」  
4. 界面显示识别原文、译文  
5. 下载或到目录查看输出：
   - `backend/output/result-*.txt` — 原文 + 译文  
   - `backend/output/result-*-tts.mp3` — 目标语言合成音频  
   - `backend/logs/run-*.log` — 本次运行日志  

## API

`POST /api/process`（`multipart/form-data`）

| 字段 | 说明 |
|------|------|
| `audio` | 音频文件（wav/mp3） |
| `sourceLang` | 源语言，默认 `zh` |
| `targetLang` | 目标语言，默认 `en` |

## 目录结构

```
translation/
├── backend/
│   ├── public/          # Web 界面
│   ├── src/
│   │   ├── server.js
│   │   ├── routes/
│   │   └── services/    # 百度 API 封装
│   ├── output/          # 生成的 txt、mp3
│   └── logs/            # 运行日志
└── frontend/            # uni-app（可选）
```

## 说明

- MP3/WAV 会在服务端自动转为 16kHz 单声道 WAV（优先用 ffmpeg，否则用内置解码）。  
- 短语音识别适合约 60 秒以内清晰人声；更长音频需改用百度「录音文件识别」接口。  
- 请勿将 `.env` 提交到版本库。
