const audioFile = document.getElementById('audioFile');
const fileName = document.getElementById('fileName');
const btnProcess = document.getElementById('btnProcess');
const originalText = document.getElementById('originalText');
const translatedText = document.getElementById('translatedText');
const outputLinks = document.getElementById('outputLinks');
const runLog = document.getElementById('runLog');

function appendLog(line) {
  const t = new Date().toLocaleTimeString('zh-CN');
  runLog.textContent += `[${t}] ${line}\n`;
  runLog.scrollTop = runLog.scrollHeight;
}

audioFile.addEventListener('change', () => {
  const f = audioFile.files[0];
  fileName.textContent = f ? `${f.name} (${(f.size / 1024).toFixed(1)} KB)` : '未选择文件';
});

btnProcess.addEventListener('click', async () => {
  const file = audioFile.files[0];
  if (!file) {
    alert('请先选择 WAV 或 MP3 音频文件');
    return;
  }

  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!['wav', 'mp3'].includes(ext)) {
    alert('仅支持 .wav 和 .mp3');
    return;
  }

  btnProcess.disabled = true;
  runLog.textContent = '';
  originalText.textContent = '处理中…';
  translatedText.textContent = '处理中…';
  outputLinks.innerHTML = '<li class="hint">处理中…</li>';

  appendLog(`选择文件: ${file.name}`);
  appendLog('上传并调用 ASR → MT → TTS…');

  const form = new FormData();
  form.append('audio', file);
  form.append('sourceLang', document.getElementById('sourceLang').value);
  form.append('targetLang', document.getElementById('targetLang').value);

  try {
    const res = await fetch('/api/process', { method: 'POST', body: form });
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.message || '处理失败');
    }

    originalText.textContent = data.originalText;
    translatedText.textContent = data.translatedText;

    outputLinks.innerHTML = `
      <li><a href="${data.files.resultTxt}" download>下载：原文与译文 (.txt)</a></li>
      <li><a href="${data.files.ttsAudio}" download>下载：合成语音 (.mp3)</a></li>
      <li class="hint">服务端目录: backend/output/</li>
    `;

    appendLog('ASR 识别完成');
    appendLog('MT 翻译完成');
    appendLog('TTS 已保存到 output');
    if (data.logFile) {
      appendLog(`服务端日志: backend/logs/${data.logFile}`);
    }
    appendLog('全部完成');
  } catch (e) {
    originalText.textContent = '—';
    translatedText.textContent = '—';
    outputLinks.innerHTML = '<li class="hint">处理失败</li>';
    appendLog(`错误: ${e.message}`);
    alert(e.message);
  } finally {
    btnProcess.disabled = false;
  }
});
