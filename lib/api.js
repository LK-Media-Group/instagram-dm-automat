import { setSetting } from './db.js';
import { recordOutbound, setState } from './store.js';
import { WindowClosedError } from './sender.js';
import { range } from './stats.js';

const TRIGGER_TYPES = ['comment_keyword', 'dm_keyword', 'story_reply', 'story_mention'];

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
  return true;
}

function validateAccount(db, accountId) {
  if (accountId == null) return null;
  if (!db.prepare('SELECT 1 FROM accounts WHERE id=?').get(accountId)) return 'neznámý účet (account_id)';
  return null;
}

function validateMessageTpl(t, where) {
  if (!t || typeof t !== 'object') return `${where}: šablona musí být objekt`;
  if (t.buttons != null) {
    if (!Array.isArray(t.buttons) || t.buttons.length > 3) return `${where}: tlačítka = pole max 3 položek`;
    for (const b of t.buttons)
      if (!b || !b.title || !(b.url || b.payload)) return `${where}: každé tlačítko potřebuje title a url (web_url) nebo payload (postback)`;
  }
  if (t.quick_replies != null && !Array.isArray(t.quick_replies)) return `${where}: quick_replies musí být pole`;
  return null;
}

function validateTrigger(b) {
  if (!TRIGGER_TYPES.includes(b.type)) return 'neplatný typ triggeru';
  if (!b.name) return 'chybí název';
  if (['comment_keyword', 'dm_keyword'].includes(b.type) && !(b.keywords || []).length)
    return 'comment/dm trigger vyžaduje aspoň jedno klíčové slovo';
  if (!b.dm_template?.text) return 'chybí text DM šablony';
  const e = validateMessageTpl(b.dm_template, 'DM šablona');
  if (e) return e;
  const steps = b.dm_template.steps;
  if (steps != null) {
    if (typeof steps !== 'object' || Array.isArray(steps)) return 'steps musí být objekt { klíč: šablona }';
    for (const [k, st] of Object.entries(steps)) {
      if (!st?.text) return `krok "${k}": chybí text`;
      const se = validateMessageTpl(st, `krok "${k}"`);
      if (se) return se;
    }
  }
  return null;
}

export function createApi({ db, sender, sse }) {
  return async function handle(req, res, url, body) {
    const p = url.pathname;
    let m;
    if (p === '/api/health') return json(res, 200, { ok: true });
    if (p === '/api/events') { sse.handler(req, res); return true; }

    if (p === '/api/accounts')
      return json(res, 200, db.prepare('SELECT id, ig_user_id, username, status, token_expires_at FROM accounts ORDER BY id').all());

    if (p === '/api/triggers' && req.method === 'GET')
      return json(res, 200, db.prepare('SELECT * FROM triggers ORDER BY account_id, priority, id').all());
    if (p === '/api/triggers' && req.method === 'POST') {
      const err = validateTrigger(body) || validateAccount(db, body.account_id);
      if (err) return json(res, 400, { error: err });
      db.prepare(`INSERT INTO triggers (account_id, type, name, keywords, media_scope, public_reply_text, dm_template, followups, active, priority)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        body.account_id || 1, body.type, body.name, JSON.stringify(body.keywords || []),
        body.media_scope || null, body.public_reply_text || null,
        JSON.stringify(body.dm_template || {}), JSON.stringify(body.followups || []),
        body.active ? 1 : 0, body.priority ?? 100);
      return json(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/triggers\/(\d+)$/)) && req.method === 'PUT') {
      const err = validateTrigger(body) || validateAccount(db, body.account_id);
      if (err) return json(res, 400, { error: err });
      db.prepare(`UPDATE triggers SET type=?, name=?, keywords=?, media_scope=?, public_reply_text=?,
        dm_template=?, followups=?, active=?, priority=?, account_id=COALESCE(?, account_id) WHERE id=?`).run(
        body.type, body.name, JSON.stringify(body.keywords || []), body.media_scope || null,
        body.public_reply_text || null, JSON.stringify(body.dm_template || {}),
        JSON.stringify(body.followups || []), body.active ? 1 : 0, body.priority ?? 100,
        body.account_id ?? null, m[1]);
      return json(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/triggers\/(\d+)$/)) && req.method === 'DELETE') {
      db.prepare('DELETE FROM triggers WHERE id=?').run(m[1]);
      return json(res, 200, { ok: true });
    }

    if (p === '/api/conversations' && req.method === 'GET')
      return json(res, 200, db.prepare(`
        SELECT c.id, c.state, c.last_user_msg_at, k.username, k.igsid, k.email, k.account_id, a.username AS account,
          (SELECT text FROM messages WHERE conversation_id=c.id ORDER BY id DESC LIMIT 1) AS last_text
        FROM conversations c JOIN contacts k ON k.id=c.contact_id LEFT JOIN accounts a ON a.id=k.account_id
        ORDER BY c.last_user_msg_at DESC NULLS LAST LIMIT 200`).all());
    if ((m = p.match(/^\/api\/conversations\/(\d+)\/messages$/)))
      return json(res, 200, messagesWithMeta(db, Number(m[1])));
    if ((m = p.match(/^\/api\/conversations\/(\d+)\/links$/)))
      return json(res, 200, db.prepare('SELECT id, token, trigger_id, step_key, url, created_at, clicked_at, clicks FROM links WHERE conversation_id=? ORDER BY id').all(m[1]));
    if ((m = p.match(/^\/api\/conversations\/(\d+)\/reply$/)) && req.method === 'POST') {
      const convo = db.prepare(`SELECT c.*, k.igsid, k.account_id FROM conversations c
        JOIN contacts k ON k.id=c.contact_id WHERE c.id=?`).get(m[1]);
      if (!convo) return json(res, 404, { error: 'konverzace nenalezena' });
      if (!body.text) return json(res, 400, { error: 'chybí text' });
      const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(convo.account_id);
      try {
        await sender.sendDM(acc, convo, { text: body.text }, 'human');
        recordOutbound(db, convo.id, { text: body.text, source: 'human' });
        sse.broadcast('message', { convoId: convo.id });
        return json(res, 200, { ok: true });
      } catch (e) {
        if (e instanceof WindowClosedError)
          return json(res, 409, { error: '24h okno je zavřené — Meta odeslání nedovolí.' });
        return json(res, 502, { error: String(e) });
      }
    }
    if ((m = p.match(/^\/api\/conversations\/(\d+)\/state$/)) && req.method === 'POST') {
      if (!['bot', 'human'].includes(body.state)) return json(res, 400, { error: 'stav musí být bot|human' });
      setState(db, Number(m[1]), body.state);
      sse.broadcast('convo', { id: Number(m[1]) });
      return json(res, 200, { ok: true });
    }

    if (p === '/api/contacts')
      return json(res, 200, db.prepare(`SELECT k.id, k.igsid, k.username, k.email, k.email_synced_at, k.first_seen, k.account_id, a.username AS account
        FROM contacts k LEFT JOIN accounts a ON a.id=k.account_id ORDER BY k.first_seen DESC LIMIT 500`).all());
    if (p === '/api/stats')
      return json(res, 200, range(db, Number(url.searchParams.get('days') || 30)));
    if (p === '/api/settings' && req.method === 'GET') {
      const out = { dry_run: '1', ai_enabled: '0', ai_daily_limit: '10', ai_allowed_links: '[]' };
      for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
      return json(res, 200, out);
    }
    if (p === '/api/settings' && req.method === 'PUT') {
      for (const [k, v] of Object.entries(body || {})) setSetting(db, k, v);
      return json(res, 200, { ok: true });
    }
    return false;
  };
}

// Detail konverzace: zprávy + `meta` (parsovaný payload). U odchozích tlačítek doplní,
// zda a kdy na ně člověk klikl — web_url přes tabulku links (token → clicked_at/clicks),
// postback podle pozdější příchozí zprávy se stejným payloadem. Legacy zprávy bez payloadu → meta null.
export function messagesWithMeta(db, convoId) {
  const rows = db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY id').all(convoId);
  const parse = (p) => { if (!p) return null; try { return JSON.parse(p); } catch { return null; } };
  const msgs = rows.map(r => ({ ...r, meta: parse(r.payload) }));
  const linkByToken = (token) => token ? db.prepare('SELECT clicked_at, clicks FROM links WHERE token=?').get(token) : null;
  msgs.forEach((msg, i) => {
    if (msg.direction !== 'out' || !msg.meta?.buttons) return;
    for (const b of msg.meta.buttons) {
      if (b.type === 'web_url') {
        const l = linkByToken(b.token);
        b.clicked_at = l?.clicked_at ?? null; b.clicks = l?.clicks ?? 0;
      } else if (b.type === 'postback') {
        const hit = msgs.slice(i + 1).find(x => x.direction === 'in' && x.meta?.click === b.payload);
        b.clicked_at = hit ? hit.created_at : null;
      }
    }
    for (const q of msg.meta.quick_replies || []) {
      const hit = msgs.slice(i + 1).find(x => x.direction === 'in' && x.meta?.click === q.payload);
      q.clicked_at = hit ? hit.created_at : null;
    }
  });
  return msgs;
}
