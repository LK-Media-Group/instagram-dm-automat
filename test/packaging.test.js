import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { openDb } from '../lib/db.js';

test('setup generates private secrets once and never overwrites existing .env', () => {
  const dir=mkdtempSync(join(tmpdir(),'ig-setup-'));
  try {
    cpSync('scripts',join(dir,'scripts'),{recursive:true});
    cpSync('.env.example',join(dir,'.env.example'));
    const run=()=>spawnSync(process.execPath,['scripts/setup.mjs'],{cwd:dir,encoding:'utf8'});
    const first=run(); assert.equal(first.status,0,first.stderr);
    const env=readFileSync(join(dir,'.env'),'utf8');
    const secret=env.match(/^ADMIN_PASSWORD=(.+)$/m)[1];
    assert.ok(secret.length>=24);
    assert.ok(!first.stdout.includes(secret));
    assert.equal(statSync(join(dir,'.env')).mode&0o777,0o600);
    assert.equal(run().status,1);
    assert.equal(readFileSync(join(dir,'.env'),'utf8'),env);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('SQLite backup includes committed WAL data and refuses to overwrite backup', () => {
  const dir=mkdtempSync(join(tmpdir(),'ig-backup-'));
  const source=join(dir,'source.db'), target=join(dir,'backup.db');
  const db=openDb(source);
  try {
    db.prepare("INSERT INTO accounts (ig_user_id) VALUES ('fixture')").run();
    const run=()=>spawnSync(process.execPath,['scripts/backup.mjs',target],{env:{...process.env,DB_PATH:source},encoding:'utf8'});
    const first=run(); assert.equal(first.status,0,first.stderr);
    const backup=openDb(target);
    assert.equal(backup.prepare('SELECT COUNT(*) n FROM accounts').get().n,1);
    assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    backup.close();
    assert.notEqual(run().status,0);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
