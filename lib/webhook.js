import { createHmac, timingSafeEqual } from 'node:crypto';

export function handleVerify(query, verifyToken) {
  if (query.get('hub.mode') === 'subscribe' && verifyToken && query.get('hub.verify_token') === verifyToken)
    return { status: 200, body: query.get('hub.challenge') || '' };
  return { status: 403, body: 'forbidden' };
}

// appSecret: string nebo pole stringů — Meta podepisuje secretem app, na které visí
// subscription (u Instagram Login to může být rodičovská Meta app, ne Instagram app).
export function verifySignature(rawBody, header, appSecret) {
  if (!header || !header.startsWith('sha256=')) return false;
  const secrets = (Array.isArray(appSecret) ? appSecret : [appSecret]).filter(Boolean);
  let given;
  try { given = Buffer.from(header.slice(7), 'hex'); } catch { return false; }
  return secrets.some(sec => {
    const expected = createHmac('sha256', sec).update(rawBody).digest();
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
