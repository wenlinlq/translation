import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '../../logs');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

let sessionLogPath = null;

export function startSessionLog() {
  const name = `run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  sessionLogPath = path.join(LOG_DIR, name);
  fs.writeFileSync(sessionLogPath, `=== 会话开始 ${new Date().toLocaleString('zh-CN')} ===\n`, 'utf8');
  return sessionLogPath;
}

export function log(level, message, data) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}${
    data !== undefined ? ` ${typeof data === 'string' ? data : JSON.stringify(data)}` : ''
  }\n`;
  console.log(line.trim());
  if (sessionLogPath) {
    fs.appendFileSync(sessionLogPath, line, 'utf8');
  }
}

export function getSessionLogPath() {
  return sessionLogPath;
}

/** 打印各阶段耗时 */
export function logTiming(stage, ms, extra) {
  const sec = (ms / 1000).toFixed(2);
  const detail = extra !== undefined ? ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : '';
  log('INFO', `[耗时] ${stage}: ${ms} ms (${sec} s)${detail}`);
}
