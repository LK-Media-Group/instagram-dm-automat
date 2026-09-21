import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSetting, getSetting } from '../lib/db.js';
import { createSender } from '../lib/sender.js';
import { createApi } from '../lib/api.js';

class FakeRes {
  writeHead(code, headers) { this.code = code; this.headers = headers; return this; }
  end(body) { this.body = body ? JSON.parse(body) : null; }
}
const u = p => new URL(`http://x${p}`);

function setup() {
  const db = openDb(':memory:');
  setSetting(db, 'dry_run', '1');
  db.prepare(`INSERT INTO accounts (ig_user_id, access_token) VALUES ('178','tok')`).run();
  const sender = createSender({ db, paceMs: 0, log: () => {} });
  const api = createApi({ db, sender, sse: { handler: () => {}, broadcast: () => {} } });
  return { db, api };
}

test('trigger CRUD s validací', async () => {
  const { db, api } = setup();
  let res = new FakeRes();
  await api({ method: 'POST' }, res, u('/api/triggers'), { type: 'dm_keyword', name: 'x', keywords: [], dm_template: { text: 't' } });
  assert.equal(res.code, 400); // dm trigger bez keywords
  res = new FakeRes();
  await api({ method: 'POST' }, res, u('/api/triggers'), { type: 'comment_keyword', name: 'ebook', keywords: ['chci'], dm_template: { text: 'DM text' }, active: true });
  assert.equal(res.code, 200);
  res = new FakeRes();
  await api({ method: 'GET' }, res, u('/api/triggers'), {});
  assert.equal(res.body.length, 1);
  res = new FakeRes();
  await api({ method: 'DELETE' }, res, u('/api/triggers/1'), {});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM triggers').get().n, 0);
});

test('manuální reply vrací 409 při zavřeném okně', async () => {
  const { db, api } = setup();
  db.prepare(`INSERT INTO contacts (account_id, igsid) VALUES (1,'u1')`).run();
  db.prepare(`INSERT INTO conversations (contact_id, last_user_msg_at) VALUES (1, 1000)`).run();
  const res = new FakeRes();
  await api({ method: 'POST' }, res, u('/api/conversations/1/reply'), { text: 'ahoj' });
  assert.equal(res.code, 409);
});

test('settings PUT/GET', async () => {
  const { db, api } = setup();
  let res = new FakeRes();
  await api({ method: 'PUT' }, res, u('/api/settings'), { ai_enabled: '1', dry_run: '0' });
  assert.equal(getSetting(db, 'ai_enabled'), '1');
  res = new FakeRes();
  await api({ method: 'GET' }, res, u('/api/settings'), {});
  assert.equal(res.body.dry_run, '0');
});

test('neznámá cesta vrací false', async () => {
  const { api } = setup();
  assert.equal(await api({ method: 'GET' }, new FakeRes(), u('/neexistuje'), {}), false);
});

test('GET /api/accounts vrací účty bez tokenů', async () => {
  const { db, api } = setup();
  db.prepare(`INSERT INTO accounts (ig_user_id, username, access_token) VALUES ('999','druhy','tok2')`).run();
  const res = new FakeRes();
  assert.equal(await api({ method: 'GET' }, res, u('/api/accounts'), {}), true);
  assert.equal(res.code, 200);
  assert.equal(res.body.length, 2);
  assert.equal(res.body[1].username, 'druhy');
  assert.equal(res.body[1].ig_user_id, '999');
  assert.equal(res.body[1].access_token, undefined);
});

test('trigger nese account_id (POST i PUT), výchozí je 1', async () => {
  const { db, api } = setup();
  db.prepare(`INSERT INTO accounts (ig_user_id, username, access_token) VALUES ('999','druhy','tok2')`).run();
  const base = { type: 'dm_keyword', name: 'x', keywords: ['a'], dm_template: { text: 't' }, active: true };
  let res = new FakeRes();
  await api({ method: 'POST' }, res, u('/api/triggers'), base);
  res = new FakeRes();
  await api({ method: 'POST' }, res, u('/api/triggers'), { ...base, account_id: 2 });
  res = new FakeRes();
  await api({ method: 'POST' }, res, u('/api/triggers'), { ...base, account_id: 7 });
  assert.equal(res.code, 400); // neexistující účet
  const rows = db.prepare('SELECT id, account_id FROM triggers ORDER BY id').all();
  assert.deepEqual(rows.map(r => r.account_id), [1, 2]);
  res = new FakeRes();
  await api({ method: 'PUT' }, res, u('/api/triggers/1'), { ...base, account_id: 2 });
  assert.equal(db.prepare('SELECT account_id FROM triggers WHERE id=1').get().account_id, 2);
  res = new FakeRes();
  await api({ method: 'PUT' }, res, u('/api/triggers/2'), base); // bez account_id → zůstává
  assert.equal(db.prepare('SELECT account_id FROM triggers WHERE id=2').get().account_id, 2);
});

test('konverzace a kontakty nesou username účtu', async () => {
  const { db, api } = setup();
  db.prepare(`UPDATE accounts SET username='vo' WHERE id=1`).run();
  db.prepare(`INSERT INTO accounts (ig_user_id, username, access_token) VALUES ('999','druhy','tok2')`).run();
  db.prepare(`INSERT INTO contacts (account_id, igsid) VALUES (2,'u1')`).run();
  db.prepare(`INSERT INTO conversations (contact_id) VALUES (1)`).run();
  let res = new FakeRes();
  await api({ method: 'GET' }, res, u('/api/conversations'), {});
  assert.equal(res.body[0].account, 'druhy');
  res = new FakeRes();
  await api({ method: 'GET' }, res, u('/api/contacts'), {});
  assert.equal(res.body[0].account, 'druhy');
});

test('validace v2 šablony: tlačítka max 3 s title a url/payload, steps objekt', async () => {
  const { api } = setup();
  const base = { type: 'dm_keyword', name: 'x', keywords: ['a'], active: true };
  let res = new FakeRes();
  await api({ method: 'POST' }, res, u('/api/triggers'), { ...base, dm_template: { text: 't', buttons: [{ title: 'A' }] } });
  assert.equal(res.code, 400);
  res = new FakeRes();
  await api({ method: 'POST' }, res, u('/api/triggers'), { ...base, dm_template: { text: 't', buttons: [1, 2, 3, 4].map(i => ({ type: 'web_url', title: 'B' + i, url: 'https://example.org' })) } });
  assert.equal(res.code, 400);
  res = new FakeRes();
  await api({ method: 'POST' }, res, u('/api/triggers'), { ...base, dm_template: { text: 't', steps: [] } });
  assert.equal(res.code, 400);
  res = new FakeRes();
  await api({ method: 'POST' }, res, u('/api/triggers'), { ...base, dm_template: { text: 't',
    buttons: [{ type: 'postback', title: 'Chci', payload: 'link' }], steps: { link: { text: 'L', buttons: [{ type: 'web_url', title: 'W', url: 'https://example.org' }] } } } });
  assert.equal(res.code, 200);
});


test('detail konverzace: zprávy nesou meta (tlačítka + kliky z links/postbacků) a /links vrací odkazy konverzace', async () => {
  const { db, api } = setup();
  db.prepare(`INSERT INTO contacts (account_id, igsid) VALUES (1,'u1')`).run();
  db.prepare(`INSERT INTO conversations (contact_id, last_user_msg_at) VALUES (1, 1000)`).run();
  db.prepare(`INSERT INTO links (token, conversation_id, trigger_id, step_key, url, clicked_at, clicks) VALUES ('tok1', 1, 7, 'link', 'https://example.org/a', 1700000500, 2)`).run();
  db.prepare(`INSERT INTO links (token, conversation_id, trigger_id, step_key, url) VALUES ('tok2', 1, 7, 'link', 'https://example.org/b')`).run();
  const ins = db.prepare(`INSERT INTO messages (conversation_id, direction, mid, text, payload, source, created_at) VALUES (1,?,?,?,?,?,?)`);
  ins.run('out', null, 'Klikni', JSON.stringify({ template: 'button', buttons: [{ type: 'postback', title: 'Chci', payload: 't7:link' }] }), 'rule', 1700000100);
  ins.run('in', 'p1', '', JSON.stringify({ kind: 'postback', click: 't7:link', title: 'Chci' }), 'user', 1700000200);
  ins.run('out', null, 'Tady', JSON.stringify({ template: 'button', buttons: [{ type: 'web_url', title: 'Otevřít', url: 'https://example.org/a', token: 'tok1' }, { type: 'web_url', title: 'B', url: 'https://example.org/b', token: 'tok2' }] }), 'rule', 1700000300);
  ins.run('out', null, 'legacy bez payloadu', null, 'rule', 1700000400);
  let res = new FakeRes();
  await api({ method: 'GET' }, res, u('/api/conversations/1/messages'), {});
  assert.equal(res.code, 200);
  const msgs = res.body;
  assert.equal(msgs.length, 4);
  assert.equal(msgs[0].meta.buttons[0].clicked_at, 1700000200, 'postback tlačítko = kliknuto podle pozdější příchozí zprávy');
  assert.deepEqual(msgs[1].meta, { kind: 'postback', click: 't7:link', title: 'Chci' });
  assert.equal(msgs[2].meta.buttons[0].clicked_at, 1700000500);
  assert.equal(msgs[2].meta.buttons[0].clicks, 2);
  assert.equal(msgs[2].meta.buttons[1].clicked_at, null);
  assert.equal(msgs[2].meta.buttons[1].clicks, 0);
  assert.equal(msgs[3].meta, null);
  res = new FakeRes();
  await api({ method: 'GET' }, res, u('/api/conversations/1/links'), {});
  assert.equal(res.code, 200);
  assert.equal(res.body.length, 2);
  assert.equal(res.body[0].token, 'tok1'); assert.equal(res.body[0].clicks, 2);
});
