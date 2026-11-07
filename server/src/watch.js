// Tempo guardato: registrazione delle sessioni di visione, statistiche ed esportazioni.
import express from 'express';
import { db, tx } from './db.js';
import { requireAuth } from './auth.js';

const pad = (n) => String(n).padStart(2, '0');

/** Giorno (YYYY-MM-DD) e ora (0-23) locali di un istante, dato l'offset del client (Date.getTimezoneOffset, in minuti). */
export function localParts(ts, tz) {
  const d = new Date(ts - tz * 60000);
  return { day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, hour: d.getUTCHours(), weekday: d.getUTCDay() };
}

/** Distribuisce i secondi guardati nelle fasce orarie toccate dall'intervallo [startMs, endMs]. */
export function distribute(startMs, endMs, seconds, tz = 0) {
  const out = new Map();
  const add = (ts, sec) => {
    const { day, hour } = localParts(ts, tz);
    const k = `${day}|${hour}`;
    const cur = out.get(k);
    out.set(k, { day, hour, seconds: (cur?.seconds || 0) + sec });
  };
  if (!(endMs > startMs)) {
    add(endMs, seconds);
    return [...out.values()];
  }
  const total = endMs - startMs;
  let t = startMs;
  for (let guard = 0; t < endMs && guard < 1000; guard++) {
    const localT = t - tz * 60000;
    const next = (Math.floor(localT / 3600000) + 1) * 3600000 + tz * 60000;
    const seg = Math.min(next, endMs);
    add(t, (seconds * (seg - t)) / total);
    t = seg;
  }
  return [...out.values()];
}

const epLabel = (f) => (f.kind === 'series' && f.season != null && f.episode != null ? `S${f.season}:E${f.episode}` : '');

export const watchRouter = express.Router();

// Registra secondi guardati: { sessionId, fileId, startedAt, endedAt, seconds, tz }
// Il web invia piccoli incrementi durante la riproduzione; l'app Android un solo invio alla chiusura del lettore.
watchRouter.post('/', requireAuth, (req, res) => {
  const b = req.body || {};
  const sessionId = String(b.sessionId || '');
  const fileId = Number(b.fileId);
  const now = Date.now();
  let endedAt = Number(b.endedAt) || now;
  let startedAt = Number(b.startedAt) || endedAt;
  let seconds = Number(b.seconds);
  const tz = Math.max(-840, Math.min(840, Number(b.tz) || 0));
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) return res.status(400).json({ error: 'sessionId non valido' });
  if (!Number.isFinite(seconds) || seconds <= 0) return res.status(400).json({ error: 'seconds non valido' });

  endedAt = Math.min(endedAt, now + 60000);
  startedAt = Math.max(Math.min(startedAt, endedAt), now - 7 * 86400000);
  seconds = Math.min(seconds, Math.max(1, (endedAt - startedAt) / 1000 + 5), 6 * 3600);

  const f = db.prepare(`SELECT f.id, f.name, f.title_id, f.season, f.episode, t.name AS title_name, t.kind
    FROM files f JOIN titles t ON t.id = f.title_id WHERE f.id = ?`).get(fileId);
  if (!f) return res.status(404).json({ error: 'File non trovato' });

  tx(() => {
    const row = db.prepare('SELECT user_id FROM watch_sessions WHERE id = ?').get(sessionId);
    if (row && row.user_id !== req.user.id) throw Object.assign(new Error('sessione di un altro utente'), { status: 403 });
    if (row) {
      db.prepare('UPDATE watch_sessions SET seconds = seconds + ?, ended_at = MAX(ended_at, ?) WHERE id = ?').run(seconds, endedAt, sessionId);
    } else {
      db.prepare(`INSERT INTO watch_sessions(id,user_id,file_id,title_id,title_name,kind,ep_label,file_name,started_at,ended_at,seconds,tz)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(sessionId, req.user.id, f.id, f.title_id, f.title_name, f.kind, epLabel(f), f.name, startedAt, endedAt, seconds, tz);
    }
    const up = db.prepare(`INSERT INTO watch_buckets(user_id,file_id,title_id,day,hour,seconds) VALUES(?,?,?,?,?,?)
      ON CONFLICT(user_id,file_id,day,hour) DO UPDATE SET seconds = seconds + excluded.seconds`);
    for (const p of distribute(startedAt, endedAt, seconds, tz)) up.run(req.user.id, f.id, f.title_id, p.day, p.hour, p.seconds);
  });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ statistiche

const RANGES = { '7d': 7, '30d': 30, '90d': 90, '365d': 365, all: null };

/** Inizio del periodo: { fromMs (UTC), fromDay (locale), days } */
export function rangeBounds(range, tz, now = Date.now()) {
  const days = RANGES[range] === undefined ? 30 : RANGES[range];
  if (days === null) return { fromMs: 0, fromDay: '0000-00-00', days: null };
  const d = new Date(now - tz * 60000);
  const startLocal = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (days - 1));
  return { fromMs: startLocal + tz * 60000, fromDay: localParts(startLocal + tz * 60000, tz).day, days };
}

function stats(userFilter, range, tz) {
  const { fromMs, fromDay, days } = rangeBounds(range, tz);
  const [uw, ua] = userFilter;
  const sw = `${uw} AND started_at >= ?`;
  const bw = `${uw} AND day >= ?`;

  const sum = db.prepare(`SELECT COALESCE(SUM(seconds),0) AS s, COUNT(*) AS n, COUNT(DISTINCT title_name) AS titles FROM watch_sessions WHERE ${sw}`).get(...ua, fromMs);
  const activeDays = db.prepare(`SELECT COUNT(DISTINCT day) AS n FROM watch_buckets WHERE ${bw}`).get(...ua, fromDay).n;

  const dailyMap = new Map(db.prepare(`SELECT day, SUM(seconds) AS s FROM watch_buckets WHERE ${bw} GROUP BY day`).all(...ua, fromDay).map((r) => [r.day, r.s]));
  const today = localParts(Date.now(), tz).day;
  let startDay = fromDay;
  if (days === null) startDay = [...dailyMap.keys()].sort()[0] || today;
  const daily = [];
  for (let d = new Date(startDay + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    daily.push({ day: k, seconds: Math.round(dailyMap.get(k) || 0) });
    if (daily.length > 4000) break;
  }

  const hourly = Array(24).fill(0);
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0)); // [0=domenica][ora]
  for (const r of db.prepare(`SELECT CAST(strftime('%w', day) AS INTEGER) AS wd, hour, SUM(seconds) AS s FROM watch_buckets WHERE ${bw} GROUP BY wd, hour`).all(...ua, fromDay)) {
    hourly[r.hour] += Math.round(r.s);
    heat[r.wd][r.hour] = Math.round(r.s);
  }

  const topTitles = db.prepare(`SELECT title_name AS name, kind, MAX(title_id) AS titleId, SUM(seconds) AS seconds, COUNT(*) AS sessions, MAX(ended_at) AS last
    FROM watch_sessions WHERE ${sw} GROUP BY title_name, kind ORDER BY seconds DESC LIMIT 30`).all(...ua, fromMs)
    .map((r) => ({ ...r, seconds: Math.round(r.seconds), poster: db.prepare('SELECT poster FROM titles WHERE id = ?').get(r.titleId)?.poster || null }));

  const videos = db.prepare(`SELECT file_id AS fileId, MAX(title_id) AS titleId, title_name AS name, kind, MAX(ep_label) AS epLabel, MAX(file_name) AS fileName,
      SUM(seconds) AS seconds, COUNT(*) AS sessions, MIN(started_at) AS first, MAX(ended_at) AS last
    FROM watch_sessions WHERE ${sw} GROUP BY file_id, title_name, kind ORDER BY seconds DESC LIMIT 200`).all(...ua, fromMs)
    .map((r) => ({ ...r, seconds: Math.round(r.seconds) }));

  const recent = db.prepare(`SELECT id, file_id AS fileId, title_id AS titleId, title_name AS name, kind, ep_label AS epLabel, file_name AS fileName,
      started_at AS startedAt, ended_at AS endedAt, seconds FROM watch_sessions WHERE ${sw} ORDER BY started_at DESC LIMIT 100`).all(...ua, fromMs)
    .map((r) => ({ ...r, seconds: Math.round(r.seconds) }));

  const total = Math.round(sum.s);
  const spanDays = days ?? Math.max(1, daily.length);
  return {
    range, tz, from: fromDay === '0000-00-00' ? startDay : fromDay,
    summary: { totalSeconds: total, sessions: sum.n, titles: sum.titles, activeDays, avgPerDay: Math.round(total / spanDays), avgPerActiveDay: activeDays ? Math.round(total / activeDays) : 0 },
    daily, hourly, heat, topTitles, videos, recent,
  };
}

export const statsRouter = express.Router();
statsRouter.use(requireAuth);

const tzOf = (req) => Math.max(-840, Math.min(840, Number(req.query.tz) || 0));
const rangeOf = (req) => (Object.prototype.hasOwnProperty.call(RANGES, req.query.range) ? req.query.range : '30d');

statsRouter.get('/', (req, res) => res.json(stats(['user_id = ?', [req.user.id]], rangeOf(req), tzOf(req))));

// Dettaglio giorno per giorno di un singolo video
statsRouter.get('/video/:fileId', (req, res) => {
  const { fromDay } = rangeBounds(rangeOf(req), tzOf(req));
  const rows = db.prepare(`SELECT day, SUM(seconds) AS s FROM watch_buckets WHERE user_id = ? AND file_id = ? AND day >= ? GROUP BY day ORDER BY day`)
    .all(req.user.id, Number(req.params.fileId), fromDay);
  res.json({ days: rows.map((r) => ({ day: r.day, seconds: Math.round(r.s) })) });
});

// ------------------------------------------------------------------ esportazione

export function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvRow = (cells) => cells.map(csvCell).join(',');

const fmtLocal = (ts, tz) => {
  const d = new Date(ts - tz * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

// GET /api/stats/export?format=csv|json&type=sessions|daily|hourly|videos&range=30d&tz=-60&all=1 (all: solo admin)
statsRouter.get('/export', (req, res) => {
  const tz = tzOf(req);
  const range = rangeOf(req);
  const format = req.query.format === 'json' ? 'json' : 'csv';
  const type = ['sessions', 'daily', 'hourly', 'videos'].includes(req.query.type) ? req.query.type : 'sessions';
  const all = req.query.all === '1';
  if (all && req.user.role !== 'admin') return res.status(403).json({ error: 'Solo amministratori' });
  const { fromMs, fromDay } = rangeBounds(range, tz);
  const uw = all ? '1 = 1' : 'user_id = ?';
  const ua = all ? [] : [req.user.id];
  const stamp = new Date().toISOString().slice(0, 10);

  const send = (name, body, mime) => {
    res.setHeader('Content-Type', `${mime}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="myvideo-${name}-${range}-${stamp}.${format}"`);
    res.send(body);
  };

  const sessions = () => db.prepare(`SELECT s.id, u.email, s.title_name, s.kind, s.ep_label, s.file_name, s.started_at, s.ended_at, s.seconds
    FROM watch_sessions s JOIN users u ON u.id = s.user_id WHERE ${uw.replace('user_id', 's.user_id')} AND s.started_at >= ? ORDER BY s.started_at`).all(...ua, fromMs);
  const daily = () => db.prepare(`SELECT ${all ? 'u.email AS email,' : ''} b.day, SUM(b.seconds) AS seconds FROM watch_buckets b ${all ? 'JOIN users u ON u.id = b.user_id' : ''}
    WHERE ${uw.replace('user_id', 'b.user_id')} AND b.day >= ? GROUP BY ${all ? 'b.user_id,' : ''} b.day ORDER BY b.day`).all(...ua, fromDay);
  const hourly = () => db.prepare(`SELECT b.day, b.hour, SUM(b.seconds) AS seconds ${all ? ', u.email AS email' : ''} FROM watch_buckets b ${all ? 'JOIN users u ON u.id = b.user_id' : ''}
    WHERE ${uw.replace('user_id', 'b.user_id')} AND b.day >= ? GROUP BY ${all ? 'b.user_id,' : ''} b.day, b.hour ORDER BY b.day, b.hour`).all(...ua, fromDay);
  const videos = () => db.prepare(`SELECT ${all ? 'u.email AS email,' : ''} s.title_name, s.kind, MAX(s.ep_label) AS ep_label, MAX(s.file_name) AS file_name, SUM(s.seconds) AS seconds, COUNT(*) AS sessions,
      MIN(s.started_at) AS first, MAX(s.ended_at) AS last FROM watch_sessions s ${all ? 'JOIN users u ON u.id = s.user_id' : ''}
    WHERE ${uw.replace('user_id', 's.user_id')} AND s.started_at >= ? GROUP BY ${all ? 's.user_id,' : ''} s.file_id, s.title_name, s.kind ORDER BY seconds DESC`).all(...ua, fromMs);

  if (format === 'json') {
    const data = { exportedAt: new Date().toISOString(), range, timezoneOffsetMinutes: tz, scope: all ? 'all-users' : 'me' };
    if (type === 'sessions') data.sessions = sessions().map((r) => ({ ...r, started_at_local: fmtLocal(r.started_at, tz), ended_at_local: fmtLocal(r.ended_at, tz), seconds: Math.round(r.seconds) }));
    if (type === 'daily') data.daily = daily().map((r) => ({ ...r, seconds: Math.round(r.seconds) }));
    if (type === 'hourly') data.hourly = hourly().map((r) => ({ ...r, seconds: Math.round(r.seconds) }));
    if (type === 'videos') data.videos = videos().map((r) => ({ ...r, seconds: Math.round(r.seconds) }));
    return send(type, JSON.stringify(data, null, 2), 'application/json');
  }

  const lines = [];
  if (type === 'sessions') {
    lines.push(csvRow(['sessione', 'utente', 'inizio', 'fine', 'secondi', 'minuti', 'titolo', 'tipo', 'episodio', 'file']));
    for (const r of sessions()) lines.push(csvRow([r.id, r.email, fmtLocal(r.started_at, tz), fmtLocal(r.ended_at, tz), Math.round(r.seconds), (r.seconds / 60).toFixed(1), r.title_name, r.kind === 'series' ? 'serie' : 'film', r.ep_label, r.file_name]));
  } else if (type === 'daily') {
    lines.push(csvRow([...(all ? ['utente'] : []), 'giorno', 'secondi', 'minuti']));
    for (const r of daily()) lines.push(csvRow([...(all ? [r.email] : []), r.day, Math.round(r.seconds), (r.seconds / 60).toFixed(1)]));
  } else if (type === 'hourly') {
    lines.push(csvRow([...(all ? ['utente'] : []), 'giorno', 'ora', 'secondi', 'minuti']));
    for (const r of hourly()) lines.push(csvRow([...(all ? [r.email] : []), r.day, r.hour, Math.round(r.seconds), (r.seconds / 60).toFixed(1)]));
  } else {
    lines.push(csvRow([...(all ? ['utente'] : []), 'titolo', 'tipo', 'episodio', 'file', 'secondi', 'minuti', 'sessioni', 'prima visione', 'ultima visione']));
    for (const r of videos()) lines.push(csvRow([...(all ? [r.email] : []), r.title_name, r.kind === 'series' ? 'serie' : 'film', r.ep_label, r.file_name, Math.round(r.seconds), (r.seconds / 60).toFixed(1), r.sessions, fmtLocal(r.first, tz), fmtLocal(r.last, tz)]));
  }
  // BOM per far aprire correttamente gli accenti in Excel
  send(type, '﻿' + lines.join('\r\n') + '\r\n', 'text/csv');
});
