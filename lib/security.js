import { timingSafeEqual } from 'node:crypto';

export function validateConfig(c) {
  for (const p of [c.port, c.panelPort])
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('Invalid port');
  if (c.port === c.panelPort) throw new Error('Panel and webhook need different ports');
  if (c.adminPassword.length < 24) throw new Error('ADMIN_PASSWORD must have at least 24 characters; run npm run setup');
  if (!c.adminUser || c.adminUser.includes(':')) throw new Error('Invalid ADMIN_USER');
  if (!/^v\d+\.0$/.test(c.graphVersion)) throw new Error('Invalid GRAPH_API_VERSION');
  const url = new URL(c.publicBase);
  if (url.protocol !== 'https:' || url.pathname !== '/ig-webhook' || url.search || url.hash || url.username || url.password)
    throw new Error('PUBLIC_BASE must be https://YOUR-DOMAIN/ig-webhook');
}

function equal(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function authenticatePanel(req, res, c) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  const expected = 'Basic ' + Buffer.from(`${c.adminUser}:${c.adminPassword}`).toString('base64');
  if (!equal(req.headers.authorization || '', expected)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="IG admin", charset="UTF-8"' });
    res.end('Authentication required'); return false;
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    res.writeHead(403); res.end('Cross-site request rejected'); return false;
  }
  if (req.headers.origin) {
    let host;
    try { host = new URL(req.headers.origin).host; } catch { /* invalid origin */ }
    if (host !== req.headers.host) {
      res.writeHead(403); res.end('Origin rejected'); return false;
    }
  }
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    res.writeHead(415); res.end('Use application/json'); return false;
  }
  return true;
}
