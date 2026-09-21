import { resolve } from 'node:path';
import { loadConfig } from '../lib/config.js';
import { DatabaseSync } from 'node:sqlite';
process.umask(0o077);
const target=process.argv[2];
if (!target) { console.error('Usage: node scripts/backup.mjs /private/path/new-backup.db'); process.exit(2); }
const db=new DatabaseSync(loadConfig().dbPath, {readOnly:true});
db.prepare('VACUUM INTO ?').run(resolve(target));
db.close();
console.log('Consistent SQLite backup created. Contains tokens and message data: keep private.');
