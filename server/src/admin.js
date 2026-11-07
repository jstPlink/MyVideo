import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import { db, getSetting, setSetting } from './db.js';
import { requireAuth, requireAdmin, publicUser } from './auth.js';
import { runScan, scanState } from './scanner.js';
import { fetchPendingMetadata, metadataRunning, tmdbKey } from './tmdb.js';

export const adminRouter = express.Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/users', (req, res) => {
  const rows = db.prepare('SELECT id,email,role,status,created_at FROM users ORDER BY created_at').all();
  res.json({ users: rows });
});

adminRouter.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'Utente non trovato' });
  const status = req.body?.status;
  const role = req.body?.role;
  if (id === req.user.id && (status && status !== 'active' || role && role !== 'admin')) {
    return res.status(400).json({ error: 'Non puoi declassare o disabilitare te stesso' });
  }
  if (status && ['active', 'pending', 'disabled'].includes(status)) {
    db.prepare('UPDATE users SET status = ?, token_version = token_version + 1 WHERE id = ?').run(status, id);
  }
  if (role && ['admin', 'user'].includes(role)) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

adminRouter.post('/users/:id/reset-password', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: 'Utente non trovato' });
  const temp = crypto.randomBytes(9).toString('base64url');
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(bcrypt.hashSync(temp, 11), id);
  res.json({ temporaryPassword: temp });
});

adminRouter.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Non puoi eliminare te stesso' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

function libraryInfo() {
  const c = (sql) => db.prepare(sql).get().n;
  return {
    scan: scanState,
    metadataRunning: metadataRunning(),
    tmdbConfigured: !!tmdbKey(),
    counts: {
      movies: c("SELECT COUNT(*) n FROM titles WHERE kind='movie'"),
      series: c("SELECT COUNT(*) n FROM titles WHERE kind='series'"),
      files: c('SELECT COUNT(*) n FROM files'),
      withMetadata: c("SELECT COUNT(*) n FROM titles WHERE meta_status='done'"),
      withoutMetadata: c("SELECT COUNT(*) n FROM titles WHERE meta_status='none'"),
      pending: c("SELECT COUNT(*) n FROM titles WHERE meta_status='pending'"),
    },
    overrides: db.prepare('SELECT path, mode FROM overrides ORDER BY path').all(),
    folders: db.prepare("SELECT folder, kind, COUNT(*) AS titles FROM titles GROUP BY folder, kind ORDER BY folder").all(),
  };
}

adminRouter.get('/library', (req, res) => res.json(libraryInfo()));

adminRouter.post('/scan', (req, res) => {
  if (!scanState.running) runScan();
  res.json({ started: true });
});

adminRouter.post('/metadata/retry', (req, res) => {
  db.prepare("UPDATE titles SET meta_status = 'pending' WHERE meta_status = 'none'").run();
  fetchPendingMetadata().catch(() => {});
  res.json({ started: true });
});

adminRouter.put('/settings', (req, res) => {
  if (typeof req.body?.tmdbKey === 'string') {
    setSetting('tmdb_key', req.body.tmdbKey.trim());
    db.prepare("UPDATE titles SET meta_status = 'pending' WHERE meta_status = 'none'").run();
    fetchPendingMetadata().catch(() => {});
  }
  res.json({ tmdbConfigured: !!tmdbKey(), tmdbKeyFromSettings: !!getSetting('tmdb_key') });
});

// Forza il tipo di una cartella (series | movies | ignore) e riscansiona; mode null = rimuove.
adminRouter.put('/overrides', (req, res) => {
  const p = String(req.body?.path || '');
  const mode = req.body?.mode;
  if (!p) return res.status(400).json({ error: 'Percorso mancante' });
  if (mode == null) db.prepare('DELETE FROM overrides WHERE path = ?').run(p);
  else if (['series', 'movies', 'ignore'].includes(mode)) {
    db.prepare('INSERT INTO overrides(path,mode) VALUES(?,?) ON CONFLICT(path) DO UPDATE SET mode=excluded.mode').run(p, mode);
  } else return res.status(400).json({ error: 'Modo non valido' });
  if (!scanState.running) runScan();
  res.json({ ok: true });
});
