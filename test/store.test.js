import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import * as store from '../lib/store.js';

function setup() {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO accounts (ig_user_id) VALUES ('178')`).run();
  return db;
}

test('upsertContact založí i aktualizuje username', () => {
  const db = setup();
  const c1 = store.upsertContact(db, 1, 'u1', null);
  const c2 = store.upsertContact(db, 1, 'u1', 'pepa');
  assert.equal(c1.id, c2.id);
  assert.equal(c2.username, 'pepa');
  assert.equal(store.upsertContact(db, 1, 'u1', null).username, 'pepa');
});

test('recordInbound deduplikuje podle mid', () => {
  const db = setup();
  const c = store.upsertContact(db, 1, 'u1', null);
  const convo = store.getOrCreateConversation(db, c.id);
  assert.equal(store.recordInbound(db, convo.id, { mid: 'm1', text: 'ahoj' }), true);
  assert.equal(store.recordInbound(db, convo.id, { mid: 'm1', text: 'ahoj' }), false);
});

test('windowOpen: 24h od poslední zprávy uživatele', () => {
  assert.equal(store.windowOpen({ last_user_msg_at: 1000 }, 1000 + 23 * 3600), true);
  assert.equal(store.windowOpen({ last_user_msg_at: 1000 }, 1000 + 25 * 3600), false);
  assert.equal(store.windowOpen({ last_user_msg_at: null }, 5000), false);
});

test('bumpAiCounter respektuje denní limit a resetuje se novým dnem', () => {
  const db = setup();
  const c = store.upsertContact(db, 1, 'u1', null);
  const convo = store.getOrCreateConversation(db, c.id);
  assert.equal(store.bumpAiCounter(db, convo.id, 2, '2026-08-18'), true);
  assert.equal(store.bumpAiCounter(db, convo.id, 2, '2026-08-18'), true);
  assert.equal(store.bumpAiCounter(db, convo.id, 2, '2026-08-18'), false);
  assert.equal(store.bumpAiCounter(db, convo.id, 2, '2026-08-19'), true);
});

test('needsDisclosure jen před první bot odpovědí; history střídá role', () => {
  const db = setup();
  const c = store.upsertContact(db, 1, 'u1', null);
  const convo = store.getOrCreateConversation(db, c.id);
  assert.equal(store.needsDisclosure(db, convo.id), true);
  store.recordInbound(db, convo.id, { mid: 'm1', text: 'dotaz' });
  store.recordOutbound(db, convo.id, { text: 'odpověď', source: 'rule' });
  assert.equal(store.needsDisclosure(db, convo.id), false);
  const h = store.history(db, convo.id);
  assert.deepEqual(h, [{ role: 'user', content: 'dotaz' }, { role: 'assistant', content: 'odpověď' }]);
});

test('recordOutbound/recordInbound ukládají payload (tlačítka, klik) jako JSON; bez payloadu NULL', () => {
  const db = setup();
  const c = store.upsertContact(db, 1, 'u1', null);
  const convo = store.getOrCreateConversation(db, c.id);
  store.recordOutbound(db, convo.id, { text: 'Klikni', source: 'rule', payload: { template: 'button', buttons: [{ type: 'postback', title: 'Chci', payload: 't1:link' }] } });
  store.recordOutbound(db, convo.id, { text: 'prostý', source: 'rule' });
  store.recordInbound(db, convo.id, { mid: 'p1', text: '', payload: { kind: 'postback', click: 't1:link', title: 'Chci' } });
  const rows = db.prepare('SELECT direction, payload FROM messages ORDER BY id').all();
  assert.deepEqual(JSON.parse(rows[0].payload).buttons[0], { type: 'postback', title: 'Chci', payload: 't1:link' });
  assert.equal(rows[1].payload, null);
  assert.deepEqual(JSON.parse(rows[2].payload), { kind: 'postback', click: 't1:link', title: 'Chci' });
});
