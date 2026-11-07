// Interpretazione dei nomi di file/cartelle della libreria.

export const VIDEO_EXT = new Set(['mp4', 'mkv', 'avi', 'rmvb', 'webm', 'mov', 'm4v', 'wmv', 'flv', 'ts', 'mpg', 'mpeg', 'm2ts']);

export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function isVideo(name) {
  return VIDEO_EXT.has(extOf(name));
}

export function stripExt(name) {
  return isVideo(name) ? name.slice(0, name.lastIndexOf('.')) : name;
}

const JUNK = /\b(2160p|1440p|1080p|1080i|720p|576p|480p|4k|uhd|hdr\d*|bdrip|brrip|bluray|blu-ray|dvdrip|dvdmux|dlmux|webmux|web-?dl|webrip|hdtv|hdrip|xvid|divx|x264|x265|h\.?264|h\.?265|hevc|aac|ac3|dts|ita|eng|multi|dual|proper|repack|remastered)\b/i;

function tidy(s) {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—_.:,]+|[\s\-–—_.:,]+$/g, '')
    .trim();
}

/** Titolo e anno di un film dal nome del file. */
export function parseMovieName(fileName) {
  let s = stripExt(fileName);
  let year = null;
  let m = s.match(/^\s*\(((?:19|20)\d{2})\)\s*/);
  if (m) { year = Number(m[1]); s = s.slice(m[0].length); }
  s = s.replace(/\[[^\]]*\]/g, ' ').replace(/[._]+/g, ' ');
  const j = s.search(JUNK);
  if (j > 0) s = s.slice(0, j);
  // ultimo anno "isolato" non in testa al nome
  const re = /(?:^|[\s(])((?:19|20)\d{2})(?=[\s)\-]|$)/g;
  let last = null;
  let r;
  while ((r = re.exec(s))) last = r;
  if (last) {
    const yearStart = s.indexOf(last[1], last.index);
    if (yearStart > 0) {
      if (!year) year = Number(last[1]);
      s = s.slice(0, yearStart);
    }
  }
  s = s.replace(/^\s*\d{1,3}\s*[-–.]\s+/, '');
  s = s.replace(/[-\s]*by[A-Za-z]*\d+\s*$/i, '');
  s = s.replace(/\s*\([^)]*$/, '').replace(/\s*\(\s*\)/g, '');
  return { title: tidy(s), year };
}

/** Nome pulito di una serie/cartella. */
export function cleanFolderName(name) {
  let s = name.replace(/\[[^\]]*\]/g, ' ').replace(/[._]+/g, ' ');
  const j = s.search(JUNK);
  if (j > 0) s = s.slice(0, j);
  return tidy(s);
}

/** True se il nome di cartella indica una stagione (S01, Stagione 2, Season 3). */
export function seasonFromFolder(name) {
  const m = name.match(/(?:\bS|stagione\s*|season\s*)0*(\d{1,2})\b/i);
  return m ? Number(m[1]) : null;
}

/** Nome della serie togliendo il marcatore di stagione. */
export function stripSeasonMarker(name) {
  return tidy(name.replace(/[-\s]*(?:\bS|stagione\s*|season\s*)0*\d{1,2}\b/i, ' '));
}

/**
 * Estrae numero di stagione/episodio dal nome file.
 * strength: 'strong' (SxE, NxM, Ep/Episodio), 'weak' (numero isolato), null.
 */
export function parseEpisode(fileName) {
  const s = stripExt(fileName).replace(/[._]+/g, ' ');
  let m;
  if ((m = s.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i))) return { season: +m[1], episode: +m[2], strength: 'strong', explicitSeason: true, index: m.index };
  if ((m = s.match(/\b(\d{1,2})x(\d{1,3})\b/i))) return { season: +m[1], episode: +m[2], strength: 'strong', explicitSeason: true, index: m.index };
  if ((m = s.match(/\b(?:ep(?:isodio|isode)?\.?)\s*0*(\d{1,4})\b/i))) return { season: null, episode: +m[1], strength: 'strong', explicitSeason: false, index: m.index };
  if ((m = s.match(/\bE0*(\d{2,3})\b/))) return { season: null, episode: +m[1], strength: 'strong', explicitSeason: false, index: m.index };
  const re = /(?:^|\s)0*(\d{2,4})(?=\s|$)/g;
  let r;
  while ((r = re.exec(s))) {
    const n = Number(r[1]);
    if ([480, 576, 720, 1080, 1440, 2160].includes(n)) continue;
    if (r[1].length === 4 && n >= 1900 && n <= 2100) continue;
    return { season: null, episode: n, strength: 'weak', explicitSeason: false, index: r.index };
  }
  return null;
}

/** Titolo dell'episodio: cio' che segue il marcatore, ripulito. */
export function episodeTitle(fileName) {
  const base = stripExt(fileName).replace(/\[[^\]]*\]/g, ' ').replace(/[._]+/g, ' ');
  const ep = parseEpisode(fileName);
  let s = base;
  if (ep && ep.strength === 'strong') {
    const after = base
      .slice(ep.index)
      .replace(/^\s*(?:S\d{1,2}\s*E\d{1,3}|\d{1,2}x\d{1,3}|ep(?:isodio|isode)?\.?\s*0*\d{1,4}|E0*\d{2,3})\b/i, '');
    s = after;
  } else if (ep) {
    s = base.slice(ep.index).replace(/^\s*0*\d{2,4}/, '');
  }
  const j = s.search(JUNK);
  if (j >= 0) s = s.slice(0, j);
  s = s.replace(/\bSUB\b/i, '').replace(/^[\s\-–—:]+/, '');
  return tidy(s);
}

/** Prefisso comune (parole intere, minuscolo) tra i nomi. */
export function commonPrefix(names) {
  if (!names.length) return '';
  const words = names.map((n) =>
    stripExt(n).toLowerCase().replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim().split(' '));
  const out = [];
  for (let i = 0; i < words[0].length; i++) {
    const w = words[0][i];
    if (!words.every((ws) => ws[i] === w)) break;
    out.push(w);
  }
  return out.join(' ');
}
