import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import { backfillMessageMeta } from '../lib/backfill.js';

function setup() {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO accounts (ig_user_id, access_token) VALUES ('178','tok')`).run();
  db.prepare(`INSERT INTO triggers (account_id, type, name, keywords, dm_template) VALUES (1,'comment_keyword','x','["k"]',?)`).run(JSON.stringify({
    text: 'Klikni a pošleme odkaz!', buttons: [{ type: 'postback', title: 'Chci odkaz', payload: 'link' }],
    steps: { link: { text: 'Tady to je.', buttons: [{ type: 'web_url', title: 'Otevřít', url: 'https://example.org/letenky/' }] } },
  }));
  db.prepare(`INSERT INTO contacts (account_id, igsid) VALUES (1,'u1')`).run();
  db.prepare(`INSERT INTO conversations (contact_id, last_trigger_id) VALUES (1, 1)`).run();
  const ins = db.prepare(`INSERT INTO messages (conversation_id, direction, mid, text, payload, source, created_at) VALUES (1,?,?,?,NULL,?,?)`);
  ins.run('out', null, 'ℹ️ Toto je automatická zpráva.\n\nKlikni a pošleme odkaz!', 'rule', 100);
  ins.run('in', 'p1', '', 'user', 110);
  ins.run('out', null, 'Tady to je.', 'rule', 111);
  ins.run('in', 'm2', 'díky', 'user', 200);
  db.prepare(`INSERT INTO links (token, conversation_id, trigger_id, step_key, url, created_at, clicked_at, clicks) VALUES ('tk', 1, 1, 'link', 'https://example.org/letenky/', 111, 300, 1)`).run();
  return db;
}

test('backfill doplní meta odchozím zprávám podle šablony triggeru (root i krok) vč. tokenu odkazu a klik prázdné příchozí zprávě', () => {
  const db = setup();
  const dry = backfillMessageMeta(db, { apply: false });
  assert.equal(dry.out, 2); assert.equal(dry.in, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM messages WHERE payload IS NOT NULL').get().n, 0, 'dry-run nic nezapisuje');
  const r = backfillMessageMeta(db, { apply: true });
  assert.equal(r.out, 2); assert.equal(r.in, 1);
  const rows = db.prepare('SELECT direction, payload FROM messages ORDER BY id').all().map(x => ({ d: x.direction, p: x.payload ? JSON.parse(x.payload) : null }));
  assert.deepEqual(rows[0].p, { template: 'button', buttons: [{ type: 'postback', title: 'Chci odkaz', payload: 't1:link' }], quick_replies: [], backfilled: true });
  assert.deepEqual(rows[1].p, { kind: 'postback', click: 't1:link', title: 'Chci odkaz', backfilled: true });
  assert.deepEqual(rows[2].p, { template: 'button', buttons: [{ type: 'web_url', title: 'Otevřít', url: 'https://example.org/letenky/', token: 'tk' }], quick_replies: [], backfilled: true });
  assert.equal(rows[3].p, null, 'obyčejná textová zpráva zůstává bez meta');
  const again = backfillMessageMeta(db, { apply: true });
  assert.equal(again.out + again.in, 0, 'idempotentní — už doplněné nechává');
});

test('zpráva, jejíž text nesedí na žádnou šablonu, zůstane bez meta', () => {
  const db = setup();
  db.prepare(`INSERT INTO messages (conversation_id, direction, text, source, created_at) VALUES (1,'out','ruční odpověď','human',400)`).run();
  backfillMessageMeta(db, { apply: true });
  assert.equal(db.prepare(`SELECT payload FROM messages WHERE text='ruční odpověď'`).get().payload, null);
});
