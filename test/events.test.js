import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvents } from '../lib/events.js';

test('parsuje comment event', () => {
  const [ev] = parseEvents({ object: 'instagram', entry: [{ id: '178', time: 1700000000, changes: [
    { field: 'comments', value: { id: 'c9', text: 'CHCI TAKY', media: { id: 'm5' }, from: { id: 'u1', username: 'pepa' } } }
  ]}]});
  assert.equal(ev.kind, 'comment');
  assert.equal(ev.commentId, 'c9');
  assert.equal(ev.mediaId, 'm5');
  assert.equal(ev.fromUsername, 'pepa');
});

test('parsuje DM s quick reply', () => {
  const [ev] = parseEvents({ object: 'instagram', entry: [{ id: '178', messaging: [
    { sender: { id: 'u1' }, recipient: { id: '178' }, timestamp: 1700000000000,
      message: { mid: 'm1', text: 'pepa@seznam.cz', quick_reply: { payload: 'EMAIL_CAPTURE' } } }
  ]}]});
  assert.equal(ev.kind, 'dm');
  assert.equal(ev.igsid, 'u1');
  assert.equal(ev.quickReplyPayload, 'EMAIL_CAPTURE');
  assert.equal(ev.ts, 1700000000);
});

test('story reply a story mention', () => {
  const evs = parseEvents({ object: 'instagram', entry: [{ id: '178', messaging: [
    { sender: { id: 'u1' }, timestamp: 1000, message: { mid: 'm2', text: 'wow', reply_to: { story: { id: 'st1', url: 'http://x' } } } },
    { sender: { id: 'u2' }, timestamp: 2000, message: { mid: 'm3', attachments: [{ type: 'story_mention', payload: { url: 'http://y' } }] } }
  ]}]});
  assert.equal(evs[0].kind, 'story_reply');
  assert.equal(evs[0].storyId, 'st1');
  assert.equal(evs[1].kind, 'story_mention');
});

test('echo a read jsou ignore', () => {
  const evs = parseEvents({ object: 'instagram', entry: [{ id: '178', messaging: [
    { sender: { id: '178' }, message: { mid: 'm4', is_echo: true, text: 'moje odpověď' } },
    { sender: { id: 'u1' }, read: { mid: 'm4' } }
  ]}]});
  assert.deepEqual(evs.map(e => e.kind), ['ignore', 'ignore']);
});

test('nezhavaruje na ne-array entry/changes/messaging', () => {
  assert.deepEqual(parseEvents({ object: 'instagram', entry: { id: '178' } }), []);
  assert.deepEqual(parseEvents({ object: 'instagram', entry: [{ id: '178', changes: { field: 'comments' }, messaging: { sender: {} } }] }), []);
});

test('postback nese i title tlačítka (pro zobrazení kliku v konverzaci)', () => {
  const out = parseEvents({ object: 'instagram', entry: [{ id: '178', time: 1, messaging: [
    { sender: { id: 'u1' }, recipient: { id: '178' }, timestamp: 1700000000000, postback: { mid: 'p1', title: 'Chci odkaz', payload: 't1:link' } },
  ] }] });
  assert.equal(out[0].kind, 'postback');
  assert.equal(out[0].title, 'Chci odkaz');
  assert.equal(out[0].payload, 't1:link');
});
