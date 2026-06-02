import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pipelineRouter } from './routes/pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/output', express.static(path.join(__dirname, '../output')));
app.use('/logs', express.static(path.join(__dirname, '../logs')));
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api', pipelineRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'translation-backend' });
});

app.listen(PORT, () => {
  console.log(`翻译服务已启动: http://localhost:${PORT}`);
  console.log('在浏览器打开上述地址，选择本地 WAV/MP3 开始处理');
});
