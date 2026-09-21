import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';

const password = 'local-test-password-123456789';
const auth = { authorization: 'Basic ' + Buffer.from(`admin:${password}`).toString('base64') };
async function server(run, secret = 'test-secret', port = 18131) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-server-'));
  const child = spawn(process.execPath, ['server.js'], {
    env: { PATH: process.env.PATH, PORT: String(port), PANEL_PORT: String(port+1), PANEL_HOST: '127.0.0.1',
      DB_PATH: join(dir, 'test.db'), WEBHOOK_VERIFY_TOKEN: 'verify-test', META_APP_SECRET: secret, ADMIN_PASSWORD: password },
    stdio: 'ignore',
  });
  try {
    let up = false;
    for (let i=0; i<40 && !up; i++) {
      await delay(50);
      up = await fetch(`http://127.0.0.1:${port}/`).then(()=>true).catch(()=>false);
    }
    assert.ok(up, 'server did not start');
    await run(`http://127.0.0.1:${port}`, `http://127.0.0.1:${port+1}`);
  } finally { const ended = once(child, 'exit'); child.kill(); await ended; rmSync(dir, { recursive: true, force: true }); }
}

test('server: authenticated panel, isolated webhook and signed delivery', async () => {
  await server(async (base, panel) => {
    for (const prefix of ['', '/ig-webhook']) {
      const r = await fetch(`${base}${prefix}/?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=99`);
      assert.equal(await r.text(), '99');
    }
    assert.equal((await fetch(`${base}/api/accounts`, {headers:auth})).status,404);
    assert.equal((await fetch(`${base}/oauth/start`)).status,404);
    assert.equal((await fetch(`${panel}/api/accounts`)).status,401);
    assert.equal((await fetch(`${panel}/api/health`, {headers:auth})).status,200);
    const settings = await (await fetch(`${panel}/api/settings`, {headers:auth})).json();
    assert.equal(settings.dry_run,'1');
    assert.equal((await fetch(`${panel}/api/settings`, {method:'PUT',headers:{...auth,'content-type':'application/json',origin:'https://evil.example'},body:'{}'})).status,403);
    assert.equal((await fetch(`${panel}/api/settings`, {method:'PUT',headers:auth,body:'{}'})).status,415);
    assert.equal((await fetch(`${base}/ig-webhook`, {method:'POST',body:'{}'})).status,403);
    const body=JSON.stringify({object:'instagram',entry:[]});
    const signature='sha256='+createHmac('sha256','test-secret').update(body).digest('hex');
    assert.equal((await fetch(`${base}/ig-webhook`, {method:'POST',headers:{'x-hub-signature-256':signature},body})).status,200);
    assert.equal((await fetch(`${base}/ig-webhook/r/missing`, {redirect:'manual'})).status,404);
  });
});
test('empty app secrets fail closed', async () => {
  await server(async base => {
    const signature='sha256='+createHmac('sha256','').update('{}').digest('hex');
    assert.equal((await fetch(`${base}/`,{method:'POST',headers:{'x-hub-signature-256':signature},body:'{}'})).status,403);
  },'',18133);
});
