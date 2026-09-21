import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const root = new URL('../', import.meta.url);
process.umask(0o077);
const source = readFileSync(new URL('.env.example', root), 'utf8');
const env = source.replace(/^ADMIN_PASSWORD=$/m, `ADMIN_PASSWORD=${randomBytes(32).toString('base64url')}`)
  .replace(/^WEBHOOK_VERIFY_TOKEN=$/m, `WEBHOOK_VERIFY_TOKEN=${randomBytes(32).toString('hex')}`);
try { writeFileSync(new URL('.env', root), env, { flag: 'wx', mode: 0o600 }); }
catch (e) { if (e.code === 'EEXIST') { console.error('.env already exists; left unchanged.'); process.exit(1); } throw e; }
mkdirSync(new URL('data/', root), { recursive: true, mode: 0o700 });
console.log('Created private .env and data/. Edit .env locally, then npm run check. No secrets printed.');
