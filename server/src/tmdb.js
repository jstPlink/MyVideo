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

/** 1 = titoli identici; "Dragon Ball" contro "Dragon Ball Z" = 0.67 (non e' la stessa serie). */
export function similarity(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean));
  const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size);
}

/** Correzioni note alla ricerca: refusi nei nomi delle cartelle e titoli diversi su TMDB. */
export function searchQuery(name) {
  let q = name.replace(/\bdragn\b/gi, 'Dragon');
  if (/^dragon ?ball kai$/i.test(q.trim())) q = 'Dragon Ball Z Kai';
  return q;
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

/** Sceglie il risultato piu' simile; a parita' di punteggio vince il primo (il piu' popolare per TMDB). */
export function pick(results, query, year, titleKey, dateKey) {
  let best = null;
  let bestScore = 0;
  const origKey = titleKey === 'title' ? 'original_title' : 'original_name';
  for (const r of results || []) {
    let score = Math.max(similarity(query, r[titleKey]), similarity(query, r[origKey]));
    if (score < 0.6) continue;
    if (norm(query) === norm(r[titleKey]) || norm(query) === norm(r[origKey])) score += 0.5;
    if (year && r[dateKey]?.startsWith(String(year))) score += 0.3;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

function shape(d, hit, kind, fallbackYear) {
  const date = kind === 'movie' ? d?.release_date || hit?.release_date : d?.first_air_date || hit?.first_air_date;
  return {
    tmdb_id: d?.id ?? hit?.id,
    overview: d?.overview || hit?.overview || null,
    poster: d?.poster_path || hit?.poster_path || null,
    backdrop: d?.backdrop_path || hit?.backdrop_path || null,
    rating: d?.vote_average ?? hit?.vote_average ?? null,
    genres: (d?.genres || []).map((g) => g.name).join(', '),
    runtime: kind === 'movie' ? d?.runtime || null : d?.episode_run_time?.[0] || null,
    year: Number((date || '').slice(0, 4)) || fallbackYear || null,
  };
}

async function lookupTitle(t) {
  const query = searchQuery(t.name);
  if (t.kind === 'movie') {
    let res = await call('/search/movie', { query, year: t.year || undefined });
    let hit = pick(res?.results, query, t.year, 'title', 'release_date');
    if (!hit && t.year) {
      res = await call('/search/movie', { query });
      hit = pick(res?.results, query, t.year, 'title', 'release_date');
    }
    if (!hit) return null;
    return shape(await call(`/movie/${hit.id}`), hit, 'movie', t.year);
  }
  const res = await call('/search/tv', { query });
  const hit = pick(res?.results, query, null, 'name', 'first_air_date');
  if (!hit) return null;
  return shape(await call(`/tv/${hit.id}`), hit, 'series', null);
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

function store(titleId, m, locked) {
  db.prepare(`UPDATE titles SET tmdb_id=?, overview=?, poster=?, backdrop=?, rating=?, genres=?, runtime=?, year=COALESCE(?, year),
    meta_status='done', meta_locked=? WHERE id=?`)
    .run(m.tmdb_id, m.overview, m.poster, m.backdrop, m.rating, m.genres, m.runtime, m.year, locked ? 1 : 0, titleId);
}

/** Cerca su TMDB per l'Admin (correzione manuale dell'abbinamento). */
export async function searchTmdb(kind, q) {
  if (!tmdbKey()) throw new Error('Chiave TMDB non configurata');
  const res = await call(kind === 'movie' ? '/search/movie' : '/search/tv', { query: q });
  return (res?.results || []).slice(0, 12).map((r) => ({
    id: r.id,
    title: r.title || r.name,
    original: r.original_title || r.original_name,
    year: Number((r.release_date || r.first_air_date || '').slice(0, 4)) || null,
    poster: r.poster_path || null,
    overview: r.overview || '',
  }));
}

/** Imposta a mano l'abbinamento TMDB di un titolo (resta bloccato: le scansioni non lo cambiano). */
export async function setTmdbId(titleId, tmdbId) {
  const t = db.prepare('SELECT * FROM titles WHERE id = ?').get(titleId);
  if (!t) return false;
  const d = await call(`/${t.kind === 'movie' ? 'movie' : 'tv'}/${tmdbId}`);
  if (!d) throw new Error('ID TMDB non trovato');
  const m = shape(d, null, t.kind, t.year);
  store(t.id, m, true);
  if (t.kind === 'series') await fillEpisodes({ ...t, tmdb_id: m.tmdb_id });
  return true;
}

/** Toglie il blocco manuale e rifa' la ricerca automatica. */
export async function unlockTitle(titleId) {
  db.prepare("UPDATE titles SET meta_locked = 0, meta_status = 'pending', tmdb_id = NULL, poster = NULL, backdrop = NULL, overview = NULL WHERE id = ?").run(titleId);
  fetchPendingMetadata().catch(() => {});
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
    const rows = db.prepare("SELECT * FROM titles WHERE meta_status = 'pending' AND meta_locked = 0").all();
    for (const t of rows) {
      try {
        const m = await lookupTitle(t);
        if (m) {
          store(t.id, m, false);
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
