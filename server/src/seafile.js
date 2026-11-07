import { Readable } from 'node:stream';
import { config } from './config.js';

const UA = 'MyVideo/1.0';

const parsed = (() => {
  try {
    const u = new URL(config.seafileUrl);
    const m = u.pathname.match(/\/d\/([A-Za-z0-9]+)/);
    return m ? { base: u.origin, token: m[1] } : null;
  } catch {
    return null;
  }
})();

export const seafileConfigured = () => !!parsed;

async function retry(fn, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw last;
}

/** Elenco (non ricorsivo) di una cartella della condivisione. */
export async function listDir(dirPath) {
  if (!parsed) throw new Error('SEAFILE_URL non configurato o non valido');
  const url = `${parsed.base}/api/v2.1/share-links/${parsed.token}/dirents/?path=${encodeURIComponent(dirPath)}`;
  return retry(async () => {
    const r = await fetch(url, { headers: { 'user-agent': UA } });
    if (!r.ok) throw new Error(`Seafile listDir ${dirPath}: HTTP ${r.status}`);
    const j = await r.json();
    return j.dirent_list || [];
  });
}

/** Scansione ricorsiva: restituisce { dirs: [percorsi], files: [{ path, size }] }. */
export async function crawl(onProgress) {
  const files = [];
  const dirs = [];
  let queue = ['/'];
  while (queue.length) {
    const next = [];
    const results = [];
    for (let i = 0; i < queue.length; i += 4) {
      results.push(...(await Promise.all(queue.slice(i, i + 4).map((p) => listDir(p)))));
    }
    for (const list of results) {
      for (const e of list) {
        if (e.is_dir) {
          next.push(e.folder_path);
          dirs.push(e.folder_path);
        } else {
          files.push({ path: e.file_path, size: e.size });
        }
      }
    }
    onProgress?.(files.length);
    queue = next;
  }
  return { dirs, files };
}

const urlCache = new Map(); // percorso -> { url, exp }

async function resolveDownload(filePath, fresh = false) {
  const hit = urlCache.get(filePath);
  if (!fresh && hit && hit.exp > Date.now()) return hit.url;
  const u = `${parsed.base}/d/${parsed.token}/files/?p=${encodeURIComponent(filePath)}&dl=1`;
  const r = await fetch(u, { redirect: 'manual', headers: { 'user-agent': UA } });
  const loc = r.headers.get('location');
  if (!loc) throw new Error(`Seafile: nessun link di download per ${filePath} (HTTP ${r.status})`);
  const url = new URL(loc, parsed.base).toString();
  urlCache.set(filePath, { url, exp: Date.now() + 20 * 60 * 1000 });
  return url;
}

const MIME = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  rmvb: 'application/vnd.rn-realmedia-vbr',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  ts: 'video/mp2t',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  m2ts: 'video/mp2t',
};

/** Inoltra il file di Seafile al client con supporto Range, senza elaborarlo. */
export async function streamFile(req, res, file) {
  if (!parsed) {
    res.status(503).json({ error: 'Seafile non configurato' });
    return;
  }
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const headers = { 'user-agent': UA };
  if (req.headers.range) headers.range = req.headers.range;

  let up;
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = await resolveDownload(file.path, attempt > 0);
    up = await fetch(url, { headers, signal: ac.signal });
    if (up.ok || up.status === 206 || up.status === 416) break;
    urlCache.delete(file.path);
  }
  if (!up || !(up.ok || up.status === 206 || up.status === 416)) {
    res.status(502).json({ error: `Seafile ha risposto ${up?.status}` });
    return;
  }
  res.status(up.status);
  res.setHeader('Content-Type', MIME[file.ext] || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=0');
  for (const h of ['content-length', 'content-range']) {
    const v = up.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!up.body) {
    res.end();
    return;
  }
  const body = Readable.fromWeb(up.body);
  body.on('error', () => res.destroy());
  body.pipe(res);
}
