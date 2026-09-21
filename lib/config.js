import { readFileSync } from 'node:fs';

export function loadEnv(path) {
  const out = {};
  let raw = '';
  try { raw = readFileSync(path, 'utf8'); } catch { return out; }
  for (const line of raw.split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

export function loadConfig(envPath = new URL('../.env', import.meta.url).pathname) {
  const e = { ...loadEnv(envPath), ...process.env };
  return {
    port: Number(e.PORT || 8101),
    panelHost: e.PANEL_HOST || '127.0.0.1',
    webhookHost: e.WEBHOOK_HOST || '127.0.0.1',
    panelPort: Number(e.PANEL_PORT || 8102),
    adminUser: e.ADMIN_USER || 'admin',
    adminPassword: e.ADMIN_PASSWORD || '',
    graphVersion: e.GRAPH_API_VERSION || 'v23.0',
    appId: e.META_APP_ID || '',
    appSecret: e.META_APP_SECRET || '',
    parentAppSecret: e.META_PARENT_APP_SECRET || '',
    verifyToken: e.WEBHOOK_VERIFY_TOKEN || '',
    publicBase: e.PUBLIC_BASE || 'https://example.com/ig-webhook',
    aiBaseUrl: e.AI_BASE_URL || 'https://api.anthropic.com',
    aiKey: e.AI_API_KEY || '',
    aiModel: e.AI_MODEL || 'claude-haiku-4-5',
    ecomailKey: e.ECOMAIL_API_KEY || '',
    ecomailListId: e.ECOMAIL_LIST_ID || '',
    tgToken: e.TG_BOT_TOKEN || '',
    tgChat: e.TG_CHAT_ID || '',
    dbPath: e.DB_PATH || new URL('../data/ig-automat.db', import.meta.url).pathname,
  };
}
