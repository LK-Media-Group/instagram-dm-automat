import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import { normalize, matchTrigger } from '../lib/rules.js';

function setup() {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO accounts (ig_user_id) VALUES ('178')`).run();
  return db;
}
const addTrigger = (db, t) => db.prepare(
  `INSERT INTO triggers (account_id, type, name, keywords, media_scope, active, priority)
   VALUES (1, ?, ?, ?, ?, ?, ?)`)
  .run(t.type, t.name, JSON.stringify(t.keywords || []), t.media_scope || null, t.active ?? 1, t.priority ?? 100);

test('normalize řeší diakritiku a velikost', () => {
  assert.equal(normalize('CHCI TAKY, Příliš žluťoučký'), 'chci taky, prilis zlutoucky');
});

test('comment trigger matchne keyword bez ohledu na diakritiku', () => {
  const db = setup();
  addTrigger(db, { type: 'comment_keyword', name: 'ebook', keywords: ['chci taky'] });
  const t = matchTrigger(db, 1, { kind: 'comment', text: 'Jo, CHCI TAKY!', mediaId: 'm1' });
  assert.equal(t.name, 'ebook');
});

test('media_scope omezí trigger na konkrétní post', () => {
  const db = setup();
  addTrigger(db, { type: 'comment_keyword', name: 'jen-m9', keywords: ['ebook'], media_scope: 'm9' });
  assert.equal(matchTrigger(db, 1, { kind: 'comment', text: 'ebook', mediaId: 'm1' }), null);
  assert.equal(matchTrigger(db, 1, { kind: 'comment', text: 'ebook', mediaId: 'm9' }).name, 'jen-m9');
});

test('neaktivní trigger nematchne; priorita rozhoduje', () => {
  const db = setup();
  addTrigger(db, { type: 'dm_keyword', name: 'vypnuty', keywords: ['ahoj'], active: 0 });
  addTrigger(db, { type: 'dm_keyword', name: 'b', keywords: ['ahoj'], priority: 50 });
  addTrigger(db, { type: 'dm_keyword', name: 'a', keywords: ['ahoj'], priority: 10 });
  assert.equal(matchTrigger(db, 1, { kind: 'dm', text: 'Ahoj' }).name, 'a');
});

test('story_mention matchne i bez keywords, dm bez keywords ne', () => {
  const db = setup();
  addTrigger(db, { type: 'story_mention', name: 'sm', keywords: [] });
  addTrigger(db, { type: 'dm_keyword', name: 'prazdny', keywords: [] });
  assert.equal(matchTrigger(db, 1, { kind: 'story_mention', text: '' }).name, 'sm');
  assert.equal(matchTrigger(db, 1, { kind: 'dm', text: 'cokoliv' }), null);
});
