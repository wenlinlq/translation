const audioFile = document.getElementById("audioFile");
const fileName = document.getElementById("fileName");
const btnProcess = document.getElementById("btnProcess");
const btnRetranslate = document.getElementById("btnRetranslate");
const originalText = document.getElementById("originalText");
const translatedText = document.getElementById("translatedText");
const outputLinks = document.getElementById("outputLinks");
const runLog = document.getElementById("runLog");
const asrMeta = document.getElementById("asrMeta");
const ttsPlayer = document.getElementById("ttsPlayer");
const ttsHint = document.getElementById("ttsHint");
const btnPlayTts = document.getElementById("btnPlayTts");
const btnPauseTts = document.getElementById("btnPauseTts");
const ttsDownload = document.getElementById("ttsDownload");
const ttsMeta = document.getElementById("ttsMeta");
const ttsVoice = document.getElementById("ttsVoice");

let lastTtsUrl = "";

function appendLog(line) {
  const t = new Date().toLocaleTimeString("zh-CN");
  runLog.textContent += `[${t}] ${line}\n`;
  runLog.scrollTop = runLog.scrollHeight;
}

function setTtsPreview(url) {
  if (!url) return;
  lastTtsUrl = `${url}?t=${Date.now()}`;
  ttsPlayer.src = lastTtsUrl;
  ttsDownload.href = lastTtsUrl;
  ttsDownload.hidden = false;
  ttsDownload.download = "translation-tts.mp3";
  ttsHint.textContent = "可拖动进度条试听合成语音";
  btnPlayTts.disabled = false;
  btnPauseTts.disabled = false;
}

function applyResult(data) {
  originalText.value = data.originalText || "";
  translatedText.textContent = data.translatedText || "—";
  btnRetranslate.disabled = !data.originalText;

  if (data.asrMeta) {
    const mode = data.asrMode || data.asrMeta?.mode;
    if (mode === "aasr") {
      const dur = data.asrMeta.audioDurationSec;
      asrMeta.textContent = `音频文件转写 pid=${data.asrMeta.pid}，时长约 ${dur ?? "?"}s，task=${data.asrMeta.taskId || ""}`;
    } else {
      const maxSec = data.asrMeta.baiduMaxSecPerRequest ?? 60;
      asrMeta.textContent = `短语音（≤${maxSec}s）dev_pid=${data.asrMeta.devPid}，分段 ${data.asrMeta.segments ?? 1}`;
    }
  }

  if (data.files?.ttsAudio) {
    setTtsPreview(data.files.ttsAudio);
  }

  if (data.ttsMeta?.per !== undefined) {
    const ttsLine = `发音人 per=${data.ttsMeta.per}`;
    ttsMeta.textContent = data.timings?.tts
      ? `${ttsLine} · TTS 耗时 ${data.timings.tts} ms`
      : ttsLine;
    if (ttsVoice) ttsVoice.value = String(data.ttsMeta.per);
  }

  if (data.timings) {
    const t = data.timings;
    const parts = [];
    if (t.bos != null) parts.push(`BOS ${t.bos}ms`);
    if (t.asrCreate != null) parts.push(`创建任务 ${t.asrCreate}ms`);
    if (t.asrPoll != null) parts.push(`轮询 ${t.asrPoll}ms`);
    if (t.convert != null) parts.push(`转换 ${t.convert}ms`);
    if (t.asr != null) parts.push(`ASR ${t.asr}ms`);
    if (t.mt != null) parts.push(`MT ${t.mt}ms`);
    if (t.tts != null) parts.push(`TTS ${t.tts}ms`);
    if (t.total != null) parts.push(`总计 ${t.total}ms`);
    appendLog(`[耗时] ${parts.join(" · ")}`);
  }

  outputLinks.innerHTML = `
    <li><a href="${data.files.resultTxt}" download>下载：原文与译文 (.txt)</a></li>
    <li><a href="${data.files.ttsAudio}" download>下载：合成语音 (.mp3)</a></li>
    <li class="hint">服务端目录: backend/output/</li>
  `;
}

audioFile.addEventListener("change", () => {
  const f = audioFile.files[0];
  fileName.textContent = f
    ? `${f.name} (${(f.size / 1024).toFixed(1)} KB)`
    : "未选择文件";
});

btnPlayTts.addEventListener("click", () => ttsPlayer.play().catch(() => {}));
btnPauseTts.addEventListener("click", () => ttsPlayer.pause());

btnRetranslate.addEventListener("click", async () => {
  const text = originalText.value.trim();
  if (!text) {
    alert("请先填写或修正识别原文");
    return;
  }

  btnRetranslate.disabled = true;
  appendLog("使用修正原文重新翻译…");

  try {
    const res = await fetch("/api/reprocess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalText: text,
        sourceLang: document.getElementById("sourceLang").value,
        targetLang: document.getElementById("targetLang").value,
        ttsPer: ttsVoice?.value,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "处理失败");
    applyResult(data);
    appendLog("重新翻译与合成完成");
  } catch (e) {
    appendLog(`错误: ${e.message}`);
    alert(e.message);
  } finally {
    btnRetranslate.disabled = false;
  }
});

btnProcess.addEventListener("click", async () => {
  const file = audioFile.files[0];
  if (!file) {
    alert("请先选择 WAV、MP3 或 M4A 音频文件");
    return;
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!["wav", "mp3", "m4a", "aac", "mp4"].includes(ext)) {
    alert("仅支持 .wav、.mp3、.m4a");
    return;
  }

  btnProcess.disabled = true;
  btnRetranslate.disabled = true;
  runLog.textContent = "";
  originalText.value = "处理中…";
  translatedText.textContent = "处理中…";
  outputLinks.innerHTML = '<li class="hint">处理中…</li>';
  ttsPlayer.removeAttribute("src");
  ttsHint.textContent = "正在合成…";
  btnPlayTts.disabled = true;
  btnPauseTts.disabled = true;

  appendLog(`选择文件: ${file.name}`);
  appendLog("上传并调用 ASR → MT → TTS…");

  const form = new FormData();
  form.append("audio", file);
  form.append("sourceLang", document.getElementById("sourceLang").value);
  form.append("targetLang", document.getElementById("targetLang").value);
  form.append("ttsPer", ttsVoice?.value || "5118");

  try {
    const res = await fetch("/api/process", { method: "POST", body: form });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "处理失败");

    applyResult(data);
    appendLog("ASR 识别完成");
    appendLog("MT 翻译完成");
    appendLog("TTS 已保存，可试听");
    if (data.logFile) appendLog(`服务端日志: backend/logs/${data.logFile}`);
    appendLog("全部完成");
  } catch (e) {
    originalText.value = "";
    translatedText.textContent = "—";
    outputLinks.innerHTML = '<li class="hint">处理失败</li>';
    appendLog(`错误: ${e.message}`);
    alert(e.message);
  } finally {
    btnProcess.disabled = false;
  }
});
