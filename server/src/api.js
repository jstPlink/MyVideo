import express from 'express';
import { db } from './db.js';
import { requireAuth, requireStreamAuth, signToken } from './auth.js';
import { streamFile } from './seafile.js';

export const apiRouter = express.Router();

const CARD = 't.id, t.kind, t.name, t.year, t.poster, t.backdrop, t.overview, t.rating, t.genres, t.grp';

function card(t, extra = {}) {
  return {
    id: t.id, kind: t.kind, name: t.name, year: t.year, poster: t.poster, backdrop: t.backdrop,
    overview: t.overview, rating: t.rating, genres: t.genres, ...extra,
  };
}

function nextFile(fileId) {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
  if (!f) return null;
  const all = db.prepare('SELECT id, season, episode FROM files WHERE title_id = ? ORDER BY season, episode, name').all(f.title_id);
  const i = all.findIndex((x) => x.id === fileId);
  return i >= 0 && i < all.length - 1 ? all[i + 1].id : null;
}

function epLabel(f) {
  return f.season != null && f.episode != null ? `S${f.season}:E${f.episode}` : '';
}

function continueWatching(userId) {
  const rows = db.prepare(`
    SELECT p.*, t.kind FROM progress p JOIN titles t ON t.id = p.title_id
    WHERE p.user_id = ? ORDER BY p.updated_at DESC`).all(userId);
  const seen = new Set();
  const out = [];
  for (const p of rows) {
    if (seen.has(p.title_id)) continue;
    seen.add(p.title_id);
    let fileId = p.file_id;
    let position = p.position;
    let duration = p.duration;
    if (p.completed) {
      if (p.kind !== 'series') continue;
      const nf = nextFile(p.file_id);
      if (!nf) continue;
      fileId = nf;
      position = 0;
      duration = 0;
    } else if (p.position < 15) {
      continue;
    }
    const t = db.prepare(`SELECT ${CARD} FROM titles t WHERE t.id = ?`).get(p.title_id);
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    if (!t || !f) continue;
    out.push(card(t, {
      resume: { fileId, position, duration, label: epLabel(f) },
      percent: duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0,
    }));
    if (out.length >= 20) break;
  }
  return out;
}

apiRouter.get('/home', requireAuth, (req, res) => {
  const uid = req.user.id;
  const all = db.prepare(`SELECT ${CARD} FROM titles t ORDER BY t.name COLLATE NOCASE`).all();
  const rows = [];

  const cont = continueWatching(uid);
  if (cont.length) rows.push({ id: 'continue', title: 'Continua a guardare', variant: 'wide', items: cont });

  const mine = db.prepare(`SELECT ${CARD} FROM mylist m JOIN titles t ON t.id = m.title_id WHERE m.user_id = ? ORDER BY m.added_at DESC`).all(uid);
  if (mine.length) rows.push({ id: 'mylist', title: 'La mia lista', items: mine.map((t) => card(t)) });

  const recent = db.prepare(`SELECT ${CARD} FROM titles t ORDER BY t.created_at DESC, t.id DESC LIMIT 20`).all();
  if (all.length > 8) rows.push({ id: 'recent', title: 'Aggiunti di recente', items: recent.map((t) => card(t)) });

  const series = all.filter((t) => t.kind === 'series');
  if (series.length) rows.push({ id: 'series', title: 'Serie TV', items: series.map((t) => card(t)) });

  const groups = new Map();
  for (const t of all) {
    const g = t.grp || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }
  const others = [];
  for (const [g, items] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (g && items.length >= 3) rows.push({ id: 'g:' + g, title: g, items: items.map((t) => card(t)) });
    else others.push(...items);
  }
  if (others.length) rows.push({ id: 'other', title: 'Altri titoli', items: others.map((t) => card(t)) });

  // Titolo in evidenza: stabile durante il giorno, preferisce chi ha uno sfondo.
  const withBackdrop = all.filter((t) => t.backdrop && t.overview);
  const withPoster = all.filter((t) => t.poster);
  const pool = withBackdrop.length ? withBackdrop : withPoster.length ? withPoster : all;
  const day = Math.floor(Date.now() / 86400000);
  const hero = pool.length ? pool[day % pool.length] : null;
  let heroOut = null;
  if (hero) {
    const resume = cont.find((c) => c.id === hero.id)?.resume;
    let play = resume;
    if (!play) {
      const f = db.prepare('SELECT id, season, episode FROM files WHERE title_id = ? ORDER BY season, episode, name LIMIT 1').get(hero.id);
      if (f) play = { fileId: f.id, position: 0, duration: 0, label: epLabel(f) };
    }
    heroOut = card(hero, { resume: play });
  }
  res.json({ hero: heroOut, rows, empty: all.length === 0 });
});

apiRouter.get('/titles', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  const kind = req.query.kind === 'movie' || req.query.kind === 'series' ? req.query.kind : null;
  const where = [];
  const args = [];
  if (kind) { where.push('t.kind = ?'); args.push(kind); }
  if (q) { where.push('(t.name LIKE ? OR t.genres LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const rows = db.prepare(`SELECT ${CARD} FROM titles t ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.name COLLATE NOCASE LIMIT 500`).all(...args);
  res.json({ items: rows.map((t) => card(t)) });
});

apiRouter.get('/titles/:id', requireAuth, (req, res) => {
  const t = db.prepare('SELECT * FROM titles WHERE id = ?').get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Titolo non trovato' });
  const uid = req.user.id;
  const files = db.prepare(`
    SELECT f.id, f.name, f.size, f.ext, f.season, f.episode, f.ep_title, f.ep_overview, f.ep_still,
           p.position, p.duration, p.completed
    FROM files f LEFT JOIN progress p ON p.file_id = f.id AND p.user_id = ?
    WHERE f.title_id = ? ORDER BY f.season, f.episode, f.name`).all(uid, t.id);
  const inList = !!db.prepare('SELECT 1 FROM mylist WHERE user_id = ? AND title_id = ?').get(uid, t.id);
  const related = db.prepare(`SELECT ${CARD} FROM titles t WHERE t.folder = ? AND t.id != ? ORDER BY t.name COLLATE NOCASE LIMIT 30`).all(t.folder, t.id);

  // File da riprodurre: ultimo non completato, oppure il successivo, oppure il primo.
  let resume = null;
  const lastProg = db.prepare('SELECT * FROM progress WHERE user_id = ? AND title_id = ? ORDER BY updated_at DESC LIMIT 1').get(uid, t.id);
  if (lastProg) {
    if (!lastProg.completed) resume = { fileId: lastProg.file_id, position: lastProg.position };
    else {
      const nf = t.kind === 'series' ? nextFile(lastProg.file_id) : null;
      resume = nf ? { fileId: nf, position: 0 } : { fileId: files[0]?.id, position: 0 };
    }
  } else if (files[0]) {
    resume = { fileId: files[0].id, position: 0 };
  }
  res.json({
    ...card(t),
    runtime: t.runtime,
    inList,
    resume,
    files: files.map((f) => ({
      id: f.id, name: f.name, ext: f.ext, size: f.size, season: f.season, episode: f.episode,
      title: f.ep_title, overview: f.ep_overview, still: f.ep_still,
      position: f.position || 0, duration: f.duration || 0, completed: !!f.completed,
    })),
    related: related.map((r) => card(r)),
  });
});

apiRouter.get('/mylist', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT ${CARD} FROM mylist m JOIN titles t ON t.id = m.title_id WHERE m.user_id = ? ORDER BY m.added_at DESC`).all(req.user.id);
  res.json({ items: rows.map((t) => card(t)) });
});

apiRouter.post('/mylist/:titleId', requireAuth, (req, res) => {
  const tid = Number(req.params.titleId);
  const has = db.prepare('SELECT 1 FROM mylist WHERE user_id = ? AND title_id = ?').get(req.user.id, tid);
  if (has) db.prepare('DELETE FROM mylist WHERE user_id = ? AND title_id = ?').run(req.user.id, tid);
  else if (db.prepare('SELECT 1 FROM titles WHERE id = ?').get(tid)) db.prepare('INSERT INTO mylist(user_id,title_id,added_at) VALUES(?,?,?)').run(req.user.id, tid, Date.now());
  res.json({ inList: !has });
});

// Dati per riprodurre un file: URL di streaming con token breve + prossimo episodio.
apiRouter.get('/play/:fileId', requireAuth, (req, res) => {
  const fileId = Number(req.params.fileId);
  const f = db.prepare('SELECT f.*, t.name AS title_name, t.kind, t.id AS tid FROM files f JOIN titles t ON t.id = f.title_id WHERE f.id = ?').get(fileId);
  if (!f) return res.status(404).json({ error: 'File non trovato' });
  const p = db.prepare('SELECT position, duration, completed FROM progress WHERE user_id = ? AND file_id = ?').get(req.user.id, fileId);
  const token = signToken(req.user, 'stream', '12h');
  const nf = nextFile(fileId);
  res.json({
    fileId, titleId: f.tid, ext: f.ext, name: f.name, kind: f.kind,
    title: f.kind === 'series' ? `${f.title_name} ${epLabel(f)}${f.ep_title ? ' - ' + f.ep_title : ''}` : f.title_name,
    streamPath: `/api/stream/${fileId}?t=${token}`,
    position: p && !p.completed ? p.position : 0,
    nextFileId: nf,
  });
});

apiRouter.get('/stream/:fileId', requireStreamAuth, async (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.fileId));
  if (!f) return res.status(404).json({ error: 'File non trovato' });
  try {
    await streamFile(req, res, f);
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: e.message });
    else res.destroy();
  }
});

apiRouter.post('/progress', requireAuth, (req, res) => {
  const fileId = Number(req.body?.fileId);
  const position = Math.max(0, Number(req.body?.position) || 0);
  const duration = Math.max(0, Number(req.body?.duration) || 0);
  const f = db.prepare('SELECT id, title_id FROM files WHERE id = ?').get(fileId);
  if (!f) return res.status(404).json({ error: 'File non trovato' });
  const completed = duration > 0 && (position / duration > 0.92 || duration - position < 90) ? 1 : 0;
  db.prepare(`INSERT INTO progress(user_id,file_id,title_id,position,duration,completed,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(user_id,file_id) DO UPDATE SET position=excluded.position, duration=CASE WHEN excluded.duration>0 THEN excluded.duration ELSE progress.duration END,
    completed=excluded.completed, updated_at=excluded.updated_at`).run(req.user.id, fileId, f.title_id, position, duration, completed, Date.now());
  res.json({ ok: true, completed: !!completed });
});

apiRouter.delete('/progress/title/:titleId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM progress WHERE user_id = ? AND title_id = ?').run(req.user.id, Number(req.params.titleId));
  res.json({ ok: true });
});
