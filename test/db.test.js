import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { migrate, openDb, getSetting, setSetting } from '../lib/db.js';

test('openDb vytvoří schéma', () => {
  const db = openDb(':memory:');
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r => r.name);
  for (const t of ['accounts','triggers','contacts','conversations','messages','private_replies','jobs','stats_daily','events_raw','settings'])
    assert.ok(tables.includes(t), `chybí tabulka ${t}`);
});

test('settings get/set/overwrite', () => {
  const db = openDb(':memory:');
  assert.equal(getSetting(db, 'x', 'def'), 'def');
  setSetting(db, 'x', '1');
  setSetting(db, 'x', '2');
  assert.equal(getSetting(db, 'x'), '2');
});

test('mid je UNIQUE (dedup zpráv)', () => {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO accounts (ig_user_id) VALUES ('a1')`).run();
  db.prepare(`INSERT INTO contacts (account_id, igsid) VALUES (1, 's1')`).run();
  db.prepare(`INSERT INTO conversations (contact_id) VALUES (1)`).run();
  const ins = db.prepare(`INSERT OR IGNORE INTO messages (conversation_id, direction, mid, text, source) VALUES (1,'in','m1','a','user')`);
  assert.equal(ins.run().changes, 1);
  assert.equal(ins.run().changes, 0);
});

test('migrace: conversations.pending_step se doplní i do starší DB', () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE conversations (id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL UNIQUE, state TEXT NOT NULL DEFAULT 'bot',
    last_user_msg_at INTEGER, last_trigger_id INTEGER, ai_replies_today INTEGER NOT NULL DEFAULT 0, ai_replies_date TEXT)`);
  migrate(db); migrate(db); // idempotentní
  const cols = db.prepare('PRAGMA table_info(conversations)').all().map(c => c.name);
  assert.ok(cols.includes('pending_step'));
});
