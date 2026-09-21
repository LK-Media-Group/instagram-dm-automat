import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSetting } from '../lib/db.js';
import { createSender, WindowClosedError, DuplicatePrivateReplyError } from '../lib/sender.js';

function setup(dryRun = '0') {
  const db = openDb(':memory:');
  setSetting(db, 'dry_run', dryRun);
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ id: 'sent' }) };
  };
  const acc = { ig_user_id: '178', access_token: 'tok' };
  return { db, calls, acc, sender: createSender({ db, fetchFn, now: () => 100000, paceMs: 0, log: () => {} }) };
}

test('sendDM v otevřeném okně pošle správný payload', async () => {
  const { sender, acc, calls } = setup();
  await sender.sendDM(acc, { igsid: 'u9', last_user_msg_at: 100000 - 3600 }, { text: 'ahoj' }, 'rule');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes('/178/messages'));
  assert.deepEqual(calls[0].body, { recipient: { id: 'u9' }, message: { text: 'ahoj' } });
});

test('sendDM mimo okno vyhodí WindowClosedError a nic nepošle', async () => {
  const { sender, acc, calls } = setup();
  await assert.rejects(
    sender.sendDM(acc, { igsid: 'u9', last_user_msg_at: 100000 - 25 * 3600 }, { text: 'x' }, 'rule'),
    WindowClosedError);
  assert.equal(calls.length, 0);
});

test('private reply jde jen 1× na komentář', async () => {
  const { sender, acc, calls } = setup();
  await sender.sendPrivateReply(acc, 'c1', { text: 'DM' });
  await assert.rejects(sender.sendPrivateReply(acc, 'c1', { text: 'DM' }), DuplicatePrivateReplyError);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.recipient, { comment_id: 'c1' });
});

test('dry-run nevolá fetch', async () => {
  const { sender, acc, calls } = setup('1');
  await sender.sendDM(acc, { igsid: 'u9', last_user_msg_at: 100000 - 10 }, { text: 'x' }, 'rule');
  await sender.replyComment(acc, 'c1', 'verejna');
  assert.equal(calls.length, 0);
});

test('replyComment volá /{commentId}/replies', async () => {
  const { sender, acc, calls } = setup();
  await sender.replyComment(acc, 'c7', 'Mrkni do DM!');
  assert.ok(calls[0].url.includes('/c7/replies'));
  assert.equal(calls[0].body.message, 'Mrkni do DM!');
});

test('blank dry_run cannot accidentally enable real sending', async () => {
  const db=openDb(':memory:');
  setSetting(db,'dry_run','');
  let n=0;
  const sender=createSender({db,paceMs:0,log:()=>{},fetchFn:async()=>{ n++; throw Error('network'); }});
  await sender.sendDM({ig_user_id:'demo'}, {igsid:'demo-user',last_user_msg_at:Math.floor(Date.now()/1000)}, {text:'demo'},'rule');
  assert.equal(n,0);
});

test('concurrent private replies are deduplicated before transport', async () => {
  const db=openDb(':memory:');
  setSetting(db,'dry_run','0');
  let n=0;
  const sender=createSender({db,paceMs:0,fetchFn:async()=>{n++;return {ok:true,json:async()=>({})};}});
  const a={ig_user_id:'demo',access_token:'fixture'};
  const results=await Promise.allSettled([sender.sendPrivateReply(a,'comment',{text:'demo'}),sender.sendPrivateReply(a,'comment',{text:'demo'})]);
  assert.equal(n,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
});
