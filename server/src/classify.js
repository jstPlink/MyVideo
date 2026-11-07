// Trasforma l'albero di cartelle/file in "titoli" (film e serie) in modo euristico.
import {
  isVideo, extOf, parseMovieName, parseEpisode, episodeTitle, seasonFromFolder,
  stripSeasonMarker, cleanFolderName, commonPrefix,
} from './parser.js';

/** Nome di stagione di una sottocartella: toglie il nome della serie ("A tutto reality - Azione" -> "Azione"). */
export function seasonLabelOf(parentName, childName) {
  let name = childName;
  if (name.toLowerCase().startsWith(parentName.toLowerCase())) name = name.slice(parentName.length);
  name = cleanFolderName(name.replace(/^[\s\-–—:_.]+/, '')) || childName;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function buildTree(dirs, files) {
  const nodes = new Map();
  const node = (p) => {
    if (!nodes.has(p)) nodes.set(p, { path: p, name: p === '/' ? '' : p.split('/').filter(Boolean).pop(), dirs: [], files: [] });
    return nodes.get(p);
  };
  node('/');
  const parentOf = (p) => {
    const t = p.replace(/\/$/, '');
    const i = t.lastIndexOf('/');
    return i <= 0 ? '/' : t.slice(0, i + 1);
  };
  for (const d of dirs) {
    const dp = d.endsWith('/') ? d : d + '/';
    const n = node(dp);
    node(parentOf(dp)).dirs.push(n);
  }
  for (const f of files) {
    const dp = parentOf(f.path);
    node(dp).files.push({ ...f, name: f.path.slice(f.path.lastIndexOf('/') + 1) });
  }
  return node('/');
}

const hasYear = (name) => /(?:^|[\s(._])(?:19|20)\d{2}(?=[\s)._-]|$)/.test(name);

/** Le cartelle di soli episodi si riconoscono dalla numerazione o dal prefisso comune. */
export function looksEpisodic(videos) {
  if (videos.length < 3) return false;
  const eps = videos.map((v) => parseEpisode(v.name));
  const strong = eps.filter((e) => e?.strength === 'strong').length;
  if (strong / videos.length >= 0.6) return true;
  const weak = eps.filter((e) => e?.strength === 'weak' || e?.strength === 'strong').length;
  const prefix = commonPrefix(videos.map((v) => v.name));
  if (weak / videos.length >= 0.7 && prefix && !/^\(?\d+\)?$/.test(prefix)) return true;
  // stesso prefisso lungo senza numeri: puntate con titolo (es. "Missione Cosmo Ridicola - ...")
  if (videos.length >= 5 && prefix.split(' ').length >= 2 && prefix.length >= 8 && !videos.some((v) => hasYear(v.name))) return true;
  return false;
}

function episodeEntries(videos, defaultSeason) {
  const sorted = [...videos].sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }));
  return sorted.map((v, i) => {
    const e = parseEpisode(v.name);
    const explicit = !!e?.explicitSeason;
    return {
      path: v.path, name: v.name, size: v.size, ext: extOf(v.name),
      season: e?.season ?? defaultSeason ?? 1,
      episode: e?.episode ?? i + 1,
      explicit,
      epTitle: episodeTitle(v.name) || null,
    };
  });
}

/**
 * @param {string[]} dirs   percorsi di cartella
 * @param {{path:string,size:number}[]} files
 * @param {Record<string,string>} overrides percorso cartella -> 'series' | 'movies' | 'ignore'
 */
export function classify(dirs, files, overrides = {}) {
  const root = buildTree(dirs, files.filter((f) => isVideo(f.path)));
  const out = [];

  const group = (n) => {
    const parts = n.path.split('/').filter(Boolean);
    return parts[0] || '';
  };

  const movie = (n, f) => {
    const { title, year } = parseMovieName(f.name);
    out.push({
      key: 'M:' + f.path,
      kind: 'movie',
      name: title || f.name.replace(/\.[^.]+$/, ''),
      year,
      grp: group(n),
      folder: n.path,
      files: [{ path: f.path, name: f.name, size: f.size, ext: extOf(f.name), season: null, episode: null, explicit: false, epTitle: null }],
    });
  };

  const series = (n, name, entries) => {
    if (!entries.length) return;
    out.push({ key: 'S:' + n.path, kind: 'series', name, year: null, grp: group(n), folder: n.path, files: entries });
  };

  const overrideOf = (n) => {
    const o = overrides[n.path] ?? overrides[n.path.replace(/\/$/, '')];
    return typeof o === 'string' ? { mode: o } : o || {};
  };

  const seasonLabel = (parent, child) => seasonLabelOf(parent.name, child.name);

  /** Una serie unica: ogni sottocartella con video e' una stagione (ordine = elenco `order`, poi alfabetico). */
  const seasonsSeries = (n, order) => {
    const kids = n.dirs.filter((d) => d.files.length > 0).map((d) => ({ d, label: seasonLabel(n, d) }));
    if (!kids.length) return false;
    const pos = (label) => order.findIndex((o) => o.toLowerCase() === label.toLowerCase());
    kids.sort((a, b) => {
      const pa = pos(a.label);
      const pb = pos(b.label);
      if (pa >= 0 && pb >= 0) return pa - pb;
      if (pa >= 0) return -1;
      if (pb >= 0) return 1;
      return a.label.localeCompare(b.label, 'it', { numeric: true });
    });
    const entries = [];
    const seasonNames = [];
    kids.forEach((k, i) => {
      seasonNames.push({ season: i + 1, name: k.label });
      for (const e of episodeEntries(k.d.files, i + 1)) entries.push({ ...e, season: i + 1, explicit: false });
    });
    out.push({ key: 'S:' + n.path, kind: 'series', name: cleanFolderName(n.name), year: null, grp: group(n), folder: n.path, files: entries, seasonNames });
    // eventuali video direttamente nella cartella restano film a parte
    for (const f of n.files) movie(n, f);
    return true;
  };

  const visit = (n) => {
    const ov = overrideOf(n);
    const mode = ov.mode;
    if (mode === 'ignore') return;
    if (mode === 'seasons' && seasonsSeries(n, Array.isArray(ov.data) ? ov.data : [])) return;
    const videos = n.files;

    const seasonDirs = n.dirs.filter((d) => seasonFromFolder(d.name) != null);
    const isSeasonSeries = seasonDirs.length > 0 && seasonDirs.length >= n.dirs.length / 2 && mode !== 'movies';

    if (isSeasonSeries) {
      const name = cleanFolderName(stripSeasonMarker(seasonDirs[0].name)) || cleanFolderName(n.name);
      const entries = [];
      for (const d of seasonDirs) entries.push(...episodeEntries(d.files, seasonFromFolder(d.name)));
      entries.push(...episodeEntries(videos, 1));
      series(n, cleanFolderName(n.name) || name, entries);
      for (const d of n.dirs) if (!seasonDirs.includes(d)) visit(d);
      return;
    }

    if (videos.length && n.path !== '/') {
      const asSeries = mode === 'series' || (mode !== 'movies' && looksEpisodic(videos));
      if (asSeries) series(n, cleanFolderName(n.name), episodeEntries(videos, 1));
      else for (const f of videos) movie(n, f);
    } else {
      for (const f of videos) movie(n, f);
    }
    for (const d of n.dirs) visit(d);
  };

  visit(root);
  return out;
}
