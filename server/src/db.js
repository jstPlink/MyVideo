import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'myvideo.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  year INTEGER,
  grp TEXT NOT NULL DEFAULT '',
  folder TEXT NOT NULL DEFAULT '',
  tmdb_id INTEGER,
  meta_status TEXT NOT NULL DEFAULT 'pending',
  overview TEXT,
  poster TEXT,
  backdrop TEXT,
  rating REAL,
  genres TEXT,
  runtime INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_titles_grp ON titles(grp);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  ext TEXT NOT NULL,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season INTEGER,
  episode INTEGER,
  explicit INTEGER NOT NULL DEFAULT 0,
  ep_title TEXT,
  ep_overview TEXT,
  ep_still TEXT
);
CREATE INDEX IF NOT EXISTS idx_files_title ON files(title_id);

CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  duration REAL NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, file_id)
);

CREATE TABLE IF NOT EXISTS mylist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, title_id)
);

CREATE TABLE IF NOT EXISTS saga_rules (
  title_key TEXT PRIMARY KEY,
  rules TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'custom'
);

CREATE TABLE IF NOT EXISTS seasons (
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (title_id, season)
);

-- Storico di visione. Nomi copiati nella sessione (denormalizzati) cosi' la cronologia
-- resta leggibile anche se la libreria cambia; nessuna FK su file/titoli.
CREATE TABLE IF NOT EXISTS watch_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id INTEGER,
  title_id INTEGER,
  title_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  ep_label TEXT,
  file_name TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  seconds REAL NOT NULL DEFAULT 0,
  tz INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ws_user_start ON watch_sessions(user_id, started_at);

-- Secondi guardati per utente, video, giorno e ora locali del client.
CREATE TABLE IF NOT EXISTS watch_buckets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL,
  title_id INTEGER,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL,
  seconds REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, file_id, day, hour)
);
CREATE INDEX IF NOT EXISTS idx_wb_user_day ON watch_buckets(user_id, day);

CREATE TABLE IF NOT EXISTS overrides (
  path TEXT PRIMARY KEY,
  mode TEXT NOT NULL
);
`);

// Migrazioni leggere: aggiunge colonne alle tabelle create dalle versioni precedenti.
function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn('titles', 'meta_locked', 'INTEGER NOT NULL DEFAULT 0');
addColumn('overrides', 'data', 'TEXT');

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

// Algoritmo di abbinamento TMDB: quando cambia, i titoli non bloccati a mano vengono ricercati di nuovo.
const META_ALGO = '2';
if (getSetting('meta_algo') !== META_ALGO) {
  db.exec("UPDATE titles SET meta_status = 'pending' WHERE meta_locked = 0");
  setSetting('meta_algo', META_ALGO);
}
