import crypto from 'crypto';

let cachedToken = null;
let tokenExpiresAt = 0;

export async function getAccessToken(apiKey, secretKey) {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const url = new URL('https://aip.baidubce.com/oauth/2.0/token');
  url.searchParams.set('grant_type', 'client_credentials');
  url.searchParams.set('client_id', apiKey);
  url.searchParams.set('client_secret', secretKey);

  const res = await fetch(url.toString(), { method: 'POST' });
  const data = await res.json();

  if (!data.access_token) {
    throw new Error(data.error_description || data.error || '获取 access_token 失败');
  }

  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 2592000) * 1000;
  return cachedToken;
}

export function buildMtSign(appId, query, salt, secret) {
  const raw = `${appId}${query}${salt}${secret}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}
