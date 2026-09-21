import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import { today } from '../lib/store.js';
import { inc, range } from '../lib/stats.js';

test('inc inkrementuje a range vrací', () => {
  const db = openDb(':memory:');
  const day = today();
  inc(db, 5, 'dm_sent', day);
  inc(db, 5, 'dm_sent', day);
  inc(db, null, 'handoff', day);
  const rows = range(db, 30);
  assert.deepEqual(rows.find(r => r.metric === 'dm_sent'), { day, trigger_id: 5, metric: 'dm_sent', value: 2 });
  assert.equal(rows.find(r => r.metric === 'handoff').trigger_id, 0);
});
