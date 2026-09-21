import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import { createLinks } from '../lib/links.js';

test('links: wrap vytvoří redirect, hit zapíše klik, clicked() to pozná', () => {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO accounts (ig_user_id, access_token) VALUES ('178','tok')`).run();
  db.prepare(`INSERT INTO contacts (account_id, igsid) VALUES (1,'u1')`).run();
  db.prepare(`INSERT INTO conversations (contact_id) VALUES (1)`).run();
  const links = createLinks({ db, publicBase: 'https://x.example/ig-webhook/' });
  const u = links.wrap('https://example.com/e-book', { convoId: 1, triggerId: 7, stepKey: 'link' });
  assert.match(u, /^https:\/\/x\.example\/ig-webhook\/r\/[A-Za-z0-9_-]{8,}$/);
  const token = u.split('/r/')[1];
  assert.equal(links.clicked(1, 7), false);
  const h1 = links.hit(token);
  assert.equal(h1.url, 'https://example.com/e-book');
  assert.equal(h1.first, true);
  assert.equal(h1.trigger_id, 7);
  const h2 = links.hit(token);
  assert.equal(h2.first, false);
  assert.equal(db.prepare('SELECT clicks FROM links WHERE token=?').get(token).clicks, 2);
  assert.equal(links.clicked(1, 7), true);
  assert.equal(links.clicked(1, 8), false);
  assert.equal(links.hit('neexistuje'), null);
  assert.equal(links.wrap('mailto:x@y.cz', { convoId: 1 }), 'mailto:x@y.cz'); // ne-http se nebalí
  assert.equal(createLinks({ db, publicBase: '' }).wrap('https://example.net', {}), 'https://example.net'); // bez publicBase beze změny
});
