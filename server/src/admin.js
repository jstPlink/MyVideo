import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import { db, getSetting, setSetting } from './db.js';
import { requireAuth, requireAdmin, publicUser } from './auth.js';
import { runScan, scanState } from './scanner.js';
import { parseRulesText, saveRules, resetRules, sagaList } from './sagas.js';
import { fetchPendingMetadata, metadataRunning, tmdbKey, searchTmdb, setTmdbId, unlockTitle } from './tmdb.js';
import { seasonLabelOf } from './classify.js';

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

// Saghe / stagioni personalizzate delle serie con numerazione assoluta
adminRouter.get('/sagas', (req, res) => res.json({ series: sagaList() }));

adminRouter.put('/sagas/:titleId', (req, res) => {
  const rules = parseRulesText(req.body?.text);
  if (!saveRules(Number(req.params.titleId), rules)) return res.status(404).json({ error: 'Serie non trovata' });
  res.json({ ok: true, rules: rules.length });
});

adminRouter.delete('/sagas/:titleId', (req, res) => {
  if (!resetRules(Number(req.params.titleId))) return res.status(404).json({ error: 'Serie non trovata' });
  res.json({ ok: true });
});

// Cartelle unite in una serie unica (ogni sottocartella = una stagione)
function groupList() {
  const out = [];
  const lastSeg = (p) => p.replace(/\/$/, '').split('/').pop();
  const merged = db.prepare("SELECT path, data FROM overrides WHERE mode = 'seasons'").all();
  for (const m of merged) {
    const t = db.prepare('SELECT id FROM titles WHERE key = ?').get('S:' + m.path);
    const names = t ? db.prepare('SELECT name FROM seasons WHERE title_id = ? ORDER BY season').all(t.id).map((r) => r.name) : [];
    let order = [];
    try { order = JSON.parse(m.data || '[]'); } catch { /* ignora */ }
    out.push({ path: m.path, name: lastSeg(m.path), merged: true, order: names.length ? names : order });
  }
  const mergedPaths = new Set(merged.map((m) => m.path));
  const byParent = new Map();
  for (const t of db.prepare("SELECT name, folder FROM titles WHERE kind = 'series'").all()) {
    const parent = t.folder.replace(/[^/]+\/$/, '');
    if (parent === '/' || parent === t.folder || mergedPaths.has(parent)) continue;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(seasonLabelOf(lastSeg(parent), lastSeg(t.folder)));
  }
  for (const [path, kids] of byParent) {
    if (kids.length >= 2) out.push({ path, name: lastSeg(path), merged: false, order: kids.sort((a, b) => a.localeCompare(b, 'it', { numeric: true })) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

adminRouter.get('/groups', (req, res) => res.json({ groups: groupList() }));

adminRouter.put('/groups', (req, res) => {
  const p = String(req.body?.path || '');
  if (!p) return res.status(400).json({ error: 'Percorso mancante' });
  const order = Array.isArray(req.body?.order) ? req.body.order.map((x) => String(x).trim()).filter(Boolean) : [];
  db.prepare('INSERT INTO overrides(path, mode, data) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET mode=excluded.mode, data=excluded.data')
    .run(p, req.body?.merge ? 'seasons' : 'noseasons', JSON.stringify(order));
  if (!scanState.running) runScan();
  res.json({ ok: true });
});

// Correzione manuale dell'abbinamento TMDB (locandine sbagliate o mancanti)
adminRouter.get('/tmdb/search', async (req, res) => {
  try {
    const kind = req.query.kind === 'movie' ? 'movie' : 'series';
    res.json({ results: await searchTmdb(kind, String(req.query.q || '')) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

adminRouter.put('/titles/:id/tmdb', async (req, res) => {
  try {
    const ok = await setTmdbId(Number(req.params.id), Number(req.body?.tmdbId));
    if (!ok) return res.status(404).json({ error: 'Titolo non trovato' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

adminRouter.delete('/titles/:id/tmdb', async (req, res) => {
  await unlockTitle(Number(req.params.id));
  res.json({ ok: true });
});
