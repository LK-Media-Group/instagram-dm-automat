// Read a long-lived Instagram Login token from stdin, never from command arguments.
import { readFileSync } from 'node:fs';
import { loadConfig } from '../lib/config.js';
import { openDb } from '../lib/db.js';
process.umask(0o077);
const c = loadConfig();
const token = readFileSync(0, 'utf8').trim();
if (!token || /\s/.test(token)) { console.error('Pipe exactly one access token to stdin.'); process.exit(2); }
const api = `https://graph.instagram.com/${c.graphVersion}`;
async function call(path, method = 'GET') {
  const r = await fetch(`${api}${path}`, { method, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(`Meta HTTP ${r.status}, code ${data.error?.code || 'unknown'}. Check token and permissions in Meta.`);
  return data;
}
try {
  const me = await call('/me?fields=user_id,username');
  if (!me.user_id) throw new Error('Meta did not return user_id');
  const sub = await call(`/${me.user_id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,comments`, 'POST');
  if (sub.success !== true) throw new Error('Webhook subscription not confirmed; account was not saved');
  const db = openDb(c.dbPath);
  const expires = Number(process.env.IG_TOKEN_EXPIRES_AT || 0);
  if (!Number.isInteger(expires) || expires < 0) throw new Error('IG_TOKEN_EXPIRES_AT must be a Unix timestamp');
  db.prepare(`INSERT INTO accounts (ig_user_id, username, access_token, token_expires_at) VALUES (?,?,?,?)
    ON CONFLICT(ig_user_id) DO UPDATE SET username=excluded.username, access_token=excluded.access_token, token_expires_at=excluded.token_expires_at`)
    .run(String(me.user_id), me.username || '', token, expires);
  db.close();
  console.log('Account connected and webhook subscription confirmed. Expiry=0 means unknown; refresh is attempted at startup.');
} catch (e) { console.error(e.message); process.exitCode = 1; }
