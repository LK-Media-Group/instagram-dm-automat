import { authenticatePanel, validateConfig } from './lib/security.js';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { loadConfig } from './lib/config.js';
import { openDb, getSetting } from './lib/db.js';
import { handleVerify, verifySignature } from './lib/webhook.js';
import { parseEvents } from './lib/events.js';
import { createSender } from './lib/sender.js';
import { createJobs } from './lib/jobs.js';
import { createFlows } from './lib/flows.js';
import { createLinks } from './lib/links.js';
import { inc } from './lib/stats.js';
import { createAi } from './lib/ai.js';
import { createApi } from './lib/api.js';
import { createSse } from './lib/sse.js';
import { createNotifier } from './lib/telegram.js';
import { subscribeContact } from './lib/ecomail.js';
import { nowSec, today } from './lib/store.js';

const config = loadConfig();
validateConfig(config);
process.umask(0o077);
const db = openDb(config.dbPath);
const sse = createSse();
const notifyTg = createNotifier({ token: config.tgToken, chatId: config.tgChat });
const sender = createSender({ db, graphVersion: config.graphVersion });
let knowledge = '';
try { knowledge = readFileSync(new URL('./prompts/knowledge.md', import.meta.url), 'utf8'); } catch {}
const ai = createAi({ db, config, knowledge });
const handlers = {};
const jobs = createJobs({ db, handlers });
const links = createLinks({ db, publicBase: config.publicBase });
const flows = createFlows({ db, sender, jobs, ai, notifyTg, sse, links });

handlers.followup = flows.followupHandler;
handlers.ecomail_sync = async ({ contactId }) => {
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(contactId);
  if (!c?.email || !config.ecomailKey) return;
  const listId = getSetting(db, 'ecomail_list_id', config.ecomailListId);
  if (!listId) throw new Error('není nastaven ecomail_list_id');
  await subscribeContact({ apiKey: config.ecomailKey, listId, email: c.email, username: c.username });
  db.prepare('UPDATE contacts SET email_synced_at=? WHERE id=?').run(nowSec(), contactId);
  sse.broadcast('contact', { id: contactId });
};
handlers.purge_raw = async () => {
  db.prepare('DELETE FROM events_raw WHERE received_at < ?').run(nowSec() - 30 * 86400);
};
handlers.token_refresh = async () => {
  for (const a of db.prepare('SELECT * FROM accounts').all()) {
    if (!a.access_token || (a.token_expires_at || 0) - nowSec() > 14 * 86400) continue;
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${a.access_token}`);
    const d = await r.json();
    if (d.access_token)
      db.prepare('UPDATE accounts SET access_token=?, token_expires_at=? WHERE id=?')
        .run(d.access_token, nowSec() + (d.expires_in || 5184000), a.id);
    else console.error('Token refresh failed; reconnect the account in Meta.');
  }
};

const api = createApi({ db, sender, sse });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let len = 0;
    req.on('data', c => { len += c.length; if (len > 1e6) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const stripPrefix = p => (p === '/ig-webhook' || p.startsWith('/ig-webhook/')) ? (p.slice('/ig-webhook'.length) || '/') : p;

async function handlePublic(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = stripPrefix(url.pathname);
  if (req.method === 'GET' && p === '/') {
    const v = handleVerify(url.searchParams, config.verifyToken);
    console.log(`webhook verify ${v.status === 200 ? 'OK' : 'BAD (mode/token)'} ua=${req.headers['user-agent'] || '-'}`);
    res.writeHead(v.status, { 'content-type': 'text/plain' });
    return res.end(v.body);
  }
  if (req.method === 'POST' && p === '/') {
    if (!config.appSecret && !config.parentAppSecret) { res.writeHead(403); return res.end(); }
    const raw = await readBody(req);
    if (!verifySignature(raw, req.headers['x-hub-signature-256'], [config.appSecret, config.parentAppSecret])) {
      console.error(`webhook POST: neplatný podpis (ua=${req.headers['user-agent'] || '-'}, ${raw.length} B)`);
      res.writeHead(403); return res.end();
    }
    res.writeHead(200); res.end('EVENT_RECEIVED');
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return; }
    console.log(`webhook EVENT object=${payload.object || '?'} entries=${payload.entry?.length ?? 0} (${raw.length} B)`);
    db.prepare('INSERT INTO events_raw (topic, payload) VALUES (?,?)')
      .run(payload.object || '?', raw.toString('utf8'));
    for (const ev of parseEvents(payload)) {
      try { await flows.onEvent(ev); }
      catch (e) { console.error(`event ${ev.kind}: ${e}`); }
    }
    return;
  }
  if (req.method === 'GET' && p.startsWith('/r/')) {
    const hit = links.hit(p.slice(3).split('/')[0]);
    if (!hit) { res.writeHead(404); return res.end('not found'); }
    if (hit.first) { inc(db, hit.trigger_id, 'link_click'); sse.broadcast('message', { convoId: hit.conversation_id }); }
    res.writeHead(302, { location: hit.url, 'cache-control': 'no-store' });
    return res.end();
  }
  res.writeHead(404); res.end('not found');
}

async function handlePanel(req, res) {
  if (!authenticatePanel(req, res, config)) return;
  const url = new URL(req.url, 'http://x');
  let body = {};
  if (req.method === 'POST' || req.method === 'PUT') {
    try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch {}
  }
  if (await api(req, res, url, body)) return;
  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  const path = new URL(`./public${file}`, import.meta.url).pathname;
  if (!file.includes('..') && existsSync(path)) {
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8'
      : file.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    return res.end(readFileSync(path));
  }
  res.writeHead(404); res.end('not found');
}

const guard = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e);
  try { res.writeHead(500); res.end(); } catch {}
});

createServer(guard(handlePublic)).listen(config.port, config.webhookHost,
  () => console.log(`webhook: ${config.webhookHost}:${config.port}`));
createServer(guard(handlePanel)).listen(config.panelPort, config.panelHost,
  () => console.log(`panel: ${config.panelHost}:${config.panelPort}`));

let ticking = false;
setInterval(() => {
  if (ticking) return;
  ticking = true;
  jobs.tick().catch(e => console.error(e)).finally(() => { ticking = false; });
}, 30_000);
setInterval(() => {
  jobs.enqueue('purge_raw', nowSec(), {}, `purge:${today()}`);
  jobs.enqueue('token_refresh', nowSec(), {}, `refresh:${today()}`);
}, 3_600_000);
jobs.enqueue('token_refresh', nowSec(), {}, `refresh:${today()}`);
console.log(`ig-automat běží (dry_run=${getSetting(db, 'dry_run', '1')})`);
