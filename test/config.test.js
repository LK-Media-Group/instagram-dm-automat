import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { loadEnv, loadConfig } from '../lib/config.js';

test('loadEnv parsuje KEY=VALUE a ignoruje komentáře', () => {
  writeFileSync('/tmp/ig-automat-test.env', '# komentář\nPORT=9999\nMETA_APP_ID="abc"\n');
  const e = loadEnv('/tmp/ig-automat-test.env');
  assert.equal(e.PORT, '9999');
  assert.equal(e.META_APP_ID, 'abc');
  rmSync('/tmp/ig-automat-test.env');
});

test('loadConfig má defaulty', () => {
  const c = loadConfig('/tmp/neexistuje.env');
  assert.equal(c.port, 8101);
  assert.equal(c.aiModel, 'claude-haiku-4-5');
  assert.ok(c.publicBase.includes('/ig-webhook'));
});
