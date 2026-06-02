import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { BosClient } = require('@baiducloud/sdk');

function isBosConfigured() {
  return Boolean(
    process.env.BOS_ACCESS_KEY_ID &&
      process.env.BOS_SECRET_ACCESS_KEY &&
      process.env.BOS_BUCKET
  );
}

function getBosConfig() {
  const region = (process.env.BOS_REGION || 'bj').trim();
  const endpoint = (process.env.BOS_ENDPOINT || `https://${region}.bcebos.com`).trim();
  const bucket = process.env.BOS_BUCKET?.trim();
  return { region, endpoint, bucket };
}

function getBosClient() {
  const { endpoint } = getBosConfig();
  return new BosClient({
    endpoint,
    credentials: {
      ak: process.env.BOS_ACCESS_KEY_ID,
      sk: process.env.BOS_SECRET_ACCESS_KEY,
    },
  });
}

function wrapBosError(err) {
  const msg = err?.message || String(err);
  const { bucket, region, endpoint } = getBosConfig();

  if (/bucket does not exist|NoSuchBucket/i.test(msg)) {
    throw new Error(
      `BOS 存储桶不存在：请确认已在控制台创建 Bucket「${bucket}」，且 BOS_REGION=${region}、BOS_ENDPOINT=${endpoint} 与该桶所在地域一致`
    );
  }
  if (/Access Denied|InvalidAccessKeyId|SignatureDoesNotMatch/i.test(msg)) {
    throw new Error(`BOS 鉴权失败：请检查 BOS_ACCESS_KEY_ID / BOS_SECRET_ACCESS_KEY 是否正确`);
  }
  throw new Error(`BOS 上传失败: ${msg}`);
}

/**
 * 上传本地音频到 BOS，返回可供百度转写使用的 speech_url
 */
export async function uploadAudioForAsr(localPath, originalName) {
  if (!isBosConfigured()) {
    throw new Error(
      '未配置 BOS：请在 .env 设置 BOS_ACCESS_KEY_ID、BOS_SECRET_ACCESS_KEY、BOS_BUCKET'
    );
  }

  const { bucket, region } = getBosConfig();
  const client = getBosClient();
  const prefix = (process.env.BOS_PREFIX || 'translation/asr/').replace(/^\//, '');
  const safeName = path.basename(originalName || localPath).replace(/[^\w.\-()\u4e00-\u9fa5]/g, '_');
  const key = `${prefix}${Date.now()}-${safeName}`;

  try {
    await client.putObjectFromFile(bucket, key, localPath);
  } catch (err) {
    wrapBosError(err);
  }

  let speechUrl;
  if (process.env.BOS_PUBLIC_READ === '1') {
    const region = process.env.BOS_REGION || 'bj';
    speechUrl = `https://${bucket}.${region}.bcebos.com/${encodeURI(key).replace(/%2F/g, '/')}`;
  } else {
    const expiresSec = Number(process.env.BOS_URL_EXPIRES_SEC) || 86400;
    speechUrl = client.generatePresignedUrl(bucket, key, null, expiresSec);
  }

  return { speechUrl, bucket, key };
}

export async function deleteBosObject(bucket, key) {
  if (!bucket || !key) return;
  try {
    await getBosClient().deleteObject(bucket, key);
  } catch {
    /* 清理失败不影响主流程 */
  }
}

export { isBosConfigured };
