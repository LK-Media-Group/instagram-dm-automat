import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribeContact } from '../lib/ecomail.js';
import { createNotifier } from '../lib/telegram.js';

test('subscribeContact volá Ecomail API s klíčem v hlavičce', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => { calls.push({ url, opts }); return { ok: true, text: async () => '' }; };
  await subscribeContact({ apiKey: 'K', listId: '5', email: 'a@b.cz', username: 'pepa', fetchFn });
  assert.ok(calls[0].url.includes('/lists/5/subscribe'));
  assert.equal(calls[0].opts.headers.key, 'K');
  assert.equal(JSON.parse(calls[0].opts.body).subscriber_data.email, 'a@b.cz');
});

test('subscribeContact vyhodí chybu při non-2xx', async () => {
  const fetchFn = async () => ({ ok: false, status: 401, text: async () => 'bad key' });
  await assert.rejects(subscribeContact({ apiKey: 'K', listId: '5', email: 'a@b.cz', fetchFn }));
});

test('notifier bez tokenu je no-op a chybu spolkne', async () => {
  const notify = createNotifier({ token: '', chatId: '', log: () => {} });
  await notify('nic se nestane');
  const boom = createNotifier({ token: 't', chatId: 'c', fetchFn: async () => { throw new Error('síť'); }, log: () => {} });
  await boom('nespadne');
});

test('notifier posílá sendMessage', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; };
  await createNotifier({ token: 'T', chatId: '42', fetchFn })('ahoj');
  assert.ok(calls[0].url.includes('/botT/sendMessage'));
  assert.equal(calls[0].body.chat_id, '42');
});

test('notifier loguje HTTP chyby bez pádu', async () => {
  const logs = [];
  const fetchFn = async () => ({ ok: false, status: 401 });
  const notify = createNotifier({ token: 'T', chatId: '42', fetchFn, log: msg => logs.push(msg) });
  await notify('test');
  assert.equal(logs.length, 1);
  assert.ok(logs[0].includes('401'));
});
