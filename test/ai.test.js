import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSetting } from '../lib/db.js';
import { createAi } from '../lib/ai.js';

const config = { aiBaseUrl: 'https://mock', aiKey: 'K', aiModel: 'claude-haiku-4-5' };
const mkFetch = (text, calls = []) => async (url, opts) => {
  calls.push({ url, body: JSON.parse(opts.body) });
  return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
};

test('reply vrací text a posílá system s knowledge', async () => {
  const db = openDb(':memory:');
  setSetting(db, 'ai_allowed_links', '["https://example.com"]');
  const calls = [];
  const ai = createAi({ db, config, fetchFn: mkFetch('Ahoj! Mrkni na https://example.com/ebook', calls), knowledge: 'ZNALOSTNÍ BÁZE XYZ' });
  const r = await ai.reply({ id: 1 }, { username: 'pepa' }, [{ role: 'user', content: 'co ebook?' }]);
  assert.ok(r.text.includes('Ahoj'));
  assert.ok(calls[0].body.system.includes('ZNALOSTNÍ BÁZE XYZ'));
  assert.equal(calls[0].body.model, 'claude-haiku-4-5');
});

test('HANDOFF ve výstupu -> handoff', async () => {
  const db = openDb(':memory:');
  const ai = createAi({ db, config, fetchFn: mkFetch('HANDOFF'), knowledge: '' });
  const r = await ai.reply({ id: 1 }, {}, [{ role: 'user', content: 'chci vratku' }]);
  assert.ok(r.handoff);
});

test('nepovolený odkaz -> handoff', async () => {
  const db = openDb(':memory:');
  setSetting(db, 'ai_allowed_links', '["https://example.com"]');
  const ai = createAi({ db, config, fetchFn: mkFetch('Kup na https://podvod.example.com'), knowledge: '' });
  assert.ok((await ai.reply({ id: 1 }, {}, [{ role: 'user', content: 'x' }])).handoff);
});

test('cena bez podkladu -> handoff, s podkladem projde', async () => {
  const db = openDb(':memory:');
  const ai = createAi({ db, config, fetchFn: mkFetch('Stojí to 490 Kč'), knowledge: '' });
  assert.ok((await ai.reply({ id: 1 }, {}, [{ role: 'user', content: 'cena?' }])).handoff);
  setSetting(db, 'ai_price_info', 'Ukázkový produkt: 490 Kč');
  assert.ok((await ai.reply({ id: 1 }, {}, [{ role: 'user', content: 'cena?' }])).text);
});

test('API chyba -> handoff, ne výjimka', async () => {
  const db = openDb(':memory:');
  const ai = createAi({ db, config, fetchFn: async () => ({ ok: false, status: 529 }), knowledge: '' });
  assert.ok((await ai.reply({ id: 1 }, {}, [{ role: 'user', content: 'x' }])).handoff);
});

test('malformed ai_allowed_links JSON -> handoff, ne výjimka', async () => {
  const db = openDb(':memory:');
  setSetting(db, 'ai_allowed_links', 'not-json');
  const ai = createAi({ db, config, fetchFn: mkFetch('Ahoj'), knowledge: '' });
  const r = await ai.reply({ id: 1 }, {}, [{ role: 'user', content: 'ahoj' }]);
  assert.ok(r.handoff);
  assert.ok(r.handoff.includes('výjimka'));
});

test('úspěšná odpověď zaloguje spend přes spendFn (model + usage)', async () => {
  const db = openDb(':memory:');
  const spendCalls = [];
  const spendFn = async (args) => { spendCalls.push(args); };
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: 'Ahoj!' }], usage: { input_tokens: 100, output_tokens: 50 } }),
  });
  const ai = createAi({ db, config, fetchFn, knowledge: '', spendFn });
  const r = await ai.reply({ id: 1 }, {}, [{ role: 'user', content: 'ahoj' }]);
  assert.ok(r.text);
  assert.equal(spendCalls.length, 1);
  assert.equal(spendCalls[0].model, config.aiModel);
  assert.deepEqual(spendCalls[0].usage, { input_tokens: 100, output_tokens: 50 });
});

test('spendFn, který hodí výjimku, nerozbije odpověď (failure-proof)', async () => {
  const db = openDb(':memory:');
  const spendFn = async () => { throw new Error('shim nedostupný'); };
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: 'Ahoj!' }], usage: { input_tokens: 1, output_tokens: 1 } }),
  });
  const ai = createAi({ db, config, fetchFn, knowledge: '', spendFn });
  const r = await ai.reply({ id: 1 }, {}, [{ role: 'user', content: 'ahoj' }]);
  assert.ok(r.text);
});

test('res.json() throws -> handoff, ne výjimka', async () => {
  const db = openDb(':memory:');
  const badFetch = async () => ({ ok: true, json: async () => { throw new Error('bad json'); } });
  const ai = createAi({ db, config, fetchFn: badFetch, knowledge: '' });
  const r = await ai.reply({ id: 1 }, {}, [{ role: 'user', content: 'x' }]);
  assert.ok(r.handoff);
  assert.ok(r.handoff.includes('výjimka'));
});

test('allowlist rejects hostname-prefix bypass', async () => {
  const db = openDb(':memory:');
  setSetting(db,'ai_allowed_links','["https://example.com"]');
  const ai=createAi({db,config,fetchFn:mkFetch('https://example.com.evil.example/offer')});
  assert.ok((await ai.reply({}, {}, [{role:'user',content:'link'}])).handoff);
});
