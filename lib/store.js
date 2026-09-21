export const nowSec = () => Math.floor(Date.now() / 1000);
export const today = (ts = nowSec()) => new Date(ts * 1000).toISOString().slice(0, 10);

export function upsertContact(db, accountId, igsid, username) {
  db.prepare(`INSERT INTO contacts (account_id, igsid, username) VALUES (?,?,?)
    ON CONFLICT(account_id, igsid) DO UPDATE SET username=COALESCE(excluded.username, contacts.username)`)
    .run(accountId, String(igsid), username || null);
  return db.prepare('SELECT * FROM contacts WHERE account_id=? AND igsid=?').get(accountId, String(igsid));
}

export function getOrCreateConversation(db, contactId) {
  db.prepare('INSERT OR IGNORE INTO conversations (contact_id) VALUES (?)').run(contactId);
  return db.prepare('SELECT * FROM conversations WHERE contact_id=?').get(contactId);
}

export function recordInbound(db, convoId, { mid, text, payload }) {
  const r = db.prepare(`INSERT OR IGNORE INTO messages (conversation_id, direction, mid, text, payload, source)
    VALUES (?,'in',?,?,?,'user')`)
    .run(convoId, mid || null, text || null, payload ? JSON.stringify(payload) : null);
  return r.changes > 0;
}

// payload (volitelný) = meta odchozí zprávy pro detail konverzace:
//   { template:'button'|null, buttons:[{type,title,url?,token?,payload?}], quick_replies:[{title,payload}] }
export function recordOutbound(db, convoId, { text, source, payload = null }) {
  db.prepare(`INSERT INTO messages (conversation_id, direction, text, payload, source) VALUES (?,'out',?,?,?)`)
    .run(convoId, text || null, payload ? JSON.stringify(payload) : null, source);
}

export function markUserMessage(db, convoId, ts) {
  db.prepare('UPDATE conversations SET last_user_msg_at=? WHERE id=?').run(ts, convoId);
}

export function windowOpen(convo, now = nowSec()) {
  return !!convo.last_user_msg_at && convo.last_user_msg_at <= now + 300 && now - convo.last_user_msg_at < 24 * 3600;
}

export function setState(db, convoId, state) {
  db.prepare('UPDATE conversations SET state=? WHERE id=?').run(state, convoId);
}

export function bumpAiCounter(db, convoId, limit, day = today()) {
  const c = db.prepare('SELECT ai_replies_today, ai_replies_date FROM conversations WHERE id=?').get(convoId);
  const count = c.ai_replies_date === day ? c.ai_replies_today : 0;
  if (count >= limit) return false;
  db.prepare('UPDATE conversations SET ai_replies_today=?, ai_replies_date=? WHERE id=?')
    .run(count + 1, day, convoId);
  return true;
}

export function saveEmail(db, contactId, email) {
  db.prepare('UPDATE contacts SET email=? WHERE id=?').run(email, contactId);
}

export function needsDisclosure(db, convoId) {
  const row = db.prepare(`SELECT 1 FROM messages WHERE conversation_id=? AND direction='out'
    AND source IN ('rule','ai') LIMIT 1`).get(convoId);
  return !row;
}

export function history(db, convoId, limit = 10) {
  const rows = db.prepare(`SELECT direction, text FROM messages WHERE conversation_id=?
    AND text IS NOT NULL ORDER BY id DESC LIMIT ?`).all(convoId, limit).reverse();
  const out = [];
  for (const r of rows) {
    const role = r.direction === 'in' ? 'user' : 'assistant';
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + r.text;
    else out.push({ role, content: r.text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
