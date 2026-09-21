import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleVerify, verifySignature } from '../lib/webhook.js';

test('verify handshake vrací challenge při správném tokenu', () => {
  const q = new URLSearchParams('hub.mode=subscribe&hub.verify_token=tajny&hub.challenge=42');
  assert.deepEqual(handleVerify(q, 'tajny'), { status: 200, body: '42' });
});

test('verify handshake odmítne špatný token', () => {
  const q = new URLSearchParams('hub.mode=subscribe&hub.verify_token=spatny&hub.challenge=42');
  assert.equal(handleVerify(q, 'tajny').status, 403);
});

test('verifySignature přijme validní HMAC a odmítne zfalšovaný', () => {
  const body = Buffer.from('{"a":1}');
  const sig = 'sha256=' + createHmac('sha256', 'secret').update(body).digest('hex');
  assert.equal(verifySignature(body, sig, 'secret'), true);
  assert.equal(verifySignature(body, sig, 'jiny'), false);
  assert.equal(verifySignature(body, undefined, 'secret'), false);
  assert.equal(verifySignature(body, 'sha256=zz', 'secret'), false);
});

test('verifySignature bere i pole secretů (rodičovská vs. Instagram app) a ignoruje prázdné', () => {
  const body = Buffer.from('{"object":"instagram"}');
  const sig = 'sha256=' + createHmac('sha256', 'parent').update(body).digest('hex');
  assert.equal(verifySignature(body, sig, ['ig', 'parent']), true);
  assert.equal(verifySignature(body, sig, ['ig', '']), false);
  assert.equal(verifySignature(body, sig, ['', '']), false);
  assert.equal(verifySignature(body, sig, []), false);
});
