// Metadati (locandine, trame, sfondi) da TMDB.
import { config } from './config.js';
import { db, getSetting } from './db.js';

const API = 'https://api.themoviedb.org/3';

export const tmdbKey = () => getSetting('tmdb_key') || config.tmdbKey || '';

function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean));
  const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

async function call(path, params = {}) {
  const key = tmdbKey();
  const isV4 = key.length > 40; // token "read access" v4
  const u = new URL(API + path);
  u.searchParams.set('language', 'it-IT');
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  if (!isV4) u.searchParams.set('api_key', key);
  for (let i = 0; i < 3; i++) {
    const r = await fetch(u, { headers: isV4 ? { Authorization: `Bearer ${key}` } : {} });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 2000 * (i + 1))); continue; }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`TMDB ${path}: HTTP ${r.status}`);
    return r.json();
  }
  throw new Error(`TMDB ${path}: troppe richieste`);
}

function pick(results, query, year, titleKey, dateKey) {
  let best = null;
  let bestScore = 0;
  for (const r of results || []) {
    let score = Math.max(similarity(query, r[titleKey]), similarity(query, r['original_' + (titleKey === 'title' ? 'title' : 'name')]));
    if (score < 0.6) continue;
    if (year && r[dateKey]?.startsWith(String(year))) score += 0.3;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

async function lookupTitle(t) {
  if (t.kind === 'movie') {
    let res = await call('/search/movie', { query: t.name, year: t.year || undefined });
    let hit = pick(res?.results, t.name, t.year, 'title', 'release_date');
    if (!hit && t.year) {
      res = await call('/search/movie', { query: t.name });
      hit = pick(res?.results, t.name, t.year, 'title', 'release_date');
    }
    if (!hit) return null;
    const d = await call(`/movie/${hit.id}`);
    return {
      tmdb_id: hit.id, overview: d?.overview || hit.overview || null, poster: d?.poster_path || hit.poster_path,
      backdrop: d?.backdrop_path || hit.backdrop_path, rating: d?.vote_average ?? hit.vote_average ?? null,
      genres: (d?.genres || []).map((g) => g.name).join(', '), runtime: d?.runtime || null,
      year: Number((d?.release_date || hit.release_date || '').slice(0, 4)) || t.year,
    };
  }
  const res = await call('/search/tv', { query: t.name });
  const hit = pick(res?.results, t.name, null, 'name', 'first_air_date');
  if (!hit) return null;
  const d = await call(`/tv/${hit.id}`);
  return {
    tmdb_id: hit.id, overview: d?.overview || hit.overview || null, poster: d?.poster_path || hit.poster_path,
    backdrop: d?.backdrop_path || hit.backdrop_path, rating: d?.vote_average ?? hit.vote_average ?? null,
    genres: (d?.genres || []).map((g) => g.name).join(', '), runtime: d?.episode_run_time?.[0] || null,
    year: Number((d?.first_air_date || hit.first_air_date || '').slice(0, 4)) || null,
  };
}

async function fillEpisodes(title) {
  // Solo per le serie con numerazione SxE certa (es. 1x01): titoli e immagini degli episodi.
  const seasons = db.prepare('SELECT DISTINCT season FROM files WHERE title_id = ? AND explicit = 1 AND season IS NOT NULL').all(title.id);
  const upd = db.prepare('UPDATE files SET ep_title = ?, ep_overview = ?, ep_still = ? WHERE title_id = ? AND season = ? AND episode = ? AND explicit = 1');
  for (const { season } of seasons) {
    const s = await call(`/tv/${title.tmdb_id}/season/${season}`);
    for (const e of s?.episodes || []) {
      upd.run(e.name || null, e.overview || null, e.still_path || null, title.id, season, e.episode_number);
    }
  }
}

let running = false;
export const metadataRunning = () => running;

/** Cerca i metadati per tutti i titoli ancora "pending". */
export async function fetchPendingMetadata(log = console.log) {
  if (running || !tmdbKey()) return { skipped: true };
  running = true;
  let ok = 0;
  let none = 0;
  try {
    const rows = db.prepare("SELECT * FROM titles WHERE meta_status = 'pending'").all();
    for (const t of rows) {
      try {
        const m = await lookupTitle(t);
        if (m) {
          db.prepare(`UPDATE titles SET tmdb_id=?, overview=?, poster=?, backdrop=?, rating=?, genres=?, runtime=?, year=COALESCE(?, year), meta_status='done' WHERE id=?`)
            .run(m.tmdb_id, m.overview, m.poster, m.backdrop, m.rating, m.genres, m.runtime, m.year, t.id);
          if (t.kind === 'series') await fillEpisodes({ ...t, tmdb_id: m.tmdb_id });
          ok++;
        } else {
          db.prepare("UPDATE titles SET meta_status='none' WHERE id=?").run(t.id);
          none++;
        }
      } catch (e) {
        log(`TMDB: errore su "${t.name}": ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    log(`TMDB: ${ok} titoli arricchiti, ${none} senza corrispondenza`);
    return { ok, none };
  } finally {
    running = false;
  }
}
