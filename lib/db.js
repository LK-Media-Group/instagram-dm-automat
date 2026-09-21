import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  ig_user_id TEXT UNIQUE NOT NULL,
  username TEXT,
  access_token TEXT,
  token_expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS triggers (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  type TEXT NOT NULL CHECK (type IN ('comment_keyword','dm_keyword','story_reply','story_mention')),
  name TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]',
  media_scope TEXT,
  public_reply_text TEXT,
  dm_template TEXT NOT NULL DEFAULT '{}',
  followups TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  igsid TEXT NOT NULL,
  username TEXT,
  email TEXT,
  email_synced_at INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  first_seen INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (account_id, igsid)
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL UNIQUE REFERENCES contacts(id),
  state TEXT NOT NULL DEFAULT 'bot' CHECK (state IN ('bot','human')),
  last_user_msg_at INTEGER,
  last_trigger_id INTEGER,
  ai_replies_today INTEGER NOT NULL DEFAULT 0,
  ai_replies_date TEXT,
  pending_step TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  mid TEXT UNIQUE,
  text TEXT,
  payload TEXT,
  source TEXT NOT NULL CHECK (source IN ('user','rule','ai','human','system')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS private_replies (
  comment_id TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  uniq_key TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS stats_daily (
  day TEXT NOT NULL,
  trigger_id INTEGER NOT NULL DEFAULT 0,
  metric TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, trigger_id, metric)
);
CREATE TABLE IF NOT EXISTS events_raw (
  id INTEGER PRIMARY KEY,
  received_at INTEGER NOT NULL DEFAULT (unixepoch()),
  topic TEXT,
  payload TEXT
);
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  conversation_id INTEGER REFERENCES conversations(id),
  trigger_id INTEGER,
  step_key TEXT,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  clicked_at INTEGER,
  clicks INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_links_convo ON links(conversation_id, trigger_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Doplnění sloupců do DB vytvořené starší verzí schématu (idempotentní).
export function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(conversations)').all().map(c => c.name);
  if (!cols.includes('pending_step')) db.exec('ALTER TABLE conversations ADD COLUMN pending_step TEXT');
}

export function getSetting(db, key, def = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : def;
}

export function setSetting(db, key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, String(value));
}
