import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import { createJobs } from '../lib/jobs.js';

test('enqueue deduplikuje podle uniq_key', () => {
  const db = openDb(':memory:');
  const jobs = createJobs({ db, handlers: {}, log: () => {} });
  assert.equal(jobs.enqueue('x', 0, { a: 1 }, 'k1'), true);
  assert.equal(jobs.enqueue('x', 0, { a: 2 }, 'k1'), false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs').get().n, 1);
});

test('tick spustí jen splatné joby a označí done', async () => {
  const db = openDb(':memory:');
  const ran = [];
  const jobs = createJobs({ db, handlers: { x: async p => ran.push(p.a) }, log: () => {}, now: () => 1000 });
  jobs.enqueue('x', 900, { a: 'splatný' });
  jobs.enqueue('x', 2000, { a: 'budoucí' });
  await jobs.tick();
  assert.deepEqual(ran, ['splatný']);
  const states = db.prepare('SELECT state FROM jobs ORDER BY id').all().map(r => r.state);
  assert.deepEqual(states, ['done', 'pending']);
});

test('selhání -> retry s backoffem, po 3. pokusu failed', async () => {
  const db = openDb(':memory:');
  let t = 1000;
  const jobs = createJobs({ db, handlers: { x: async () => { throw new Error('bum'); } }, log: () => {}, now: () => t });
  jobs.enqueue('x', 0, {});
  await jobs.tick();
  assert.equal(db.prepare('SELECT state FROM jobs').get().state, 'pending');
  assert.equal(db.prepare('SELECT due_at FROM jobs').get().due_at, 1000 + 300);
  t += 10000;
  for (const expect of ['pending', 'failed']) {
    await jobs.tick();
    assert.equal(db.prepare('SELECT state FROM jobs').get().state, expect);
    t += 10000;
  }
  assert.equal(db.prepare('SELECT attempts FROM jobs').get().attempts, 3);
});
