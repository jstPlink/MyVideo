import { db, tx } from './db.js';
import { crawl, seafileConfigured } from './seafile.js';
import { classify } from './classify.js';
import { fetchPendingMetadata } from './tmdb.js';
import { isVideo } from './parser.js';
import { applyAllSagas } from './sagas.js';

export const scanState = { running: false, startedAt: null, finishedAt: null, files: 0, titles: 0, error: null };

function applyScan(items) {
  const now = Date.now();
  tx(() => {
    const seenTitles = new Set();
    const seenFiles = new Set();
    const getTitle = db.prepare('SELECT id FROM titles WHERE key = ?');
    const insTitle = db.prepare('INSERT INTO titles(key,kind,name,year,grp,folder,created_at) VALUES(?,?,?,?,?,?,?)');
    const updTitle = db.prepare('UPDATE titles SET kind=?, name=?, grp=?, folder=?, year=COALESCE(year, ?) WHERE id=?');
    const getFile = db.prepare('SELECT id FROM files WHERE path = ?');
    const insFile = db.prepare('INSERT INTO files(path,name,size,ext,title_id,season,episode,explicit,ep_title) VALUES(?,?,?,?,?,?,?,?,?)');
    // ep_title: non sovrascrivere i titoli TMDB gia' trovati
    const updFile = db.prepare(`UPDATE files SET name=?, size=?, ext=?, title_id=?, season=?, episode=?, explicit=?,
      ep_title = CASE WHEN ep_still IS NOT NULL OR ep_overview IS NOT NULL THEN ep_title ELSE ? END WHERE id=?`);

    for (const it of items) {
      let row = getTitle.get(it.key);
      let id;
      if (row) {
        id = row.id;
        updTitle.run(it.kind, it.name, it.grp, it.folder, it.year, id);
      } else {
        id = Number(insTitle.run(it.key, it.kind, it.name, it.year, it.grp, it.folder, now).lastInsertRowid);
      }
      seenTitles.add(id);
      for (const f of it.files) {
        const fr = getFile.get(f.path);
        if (fr) {
          updFile.run(f.name, f.size, f.ext, id, f.season, f.episode, f.explicit ? 1 : 0, f.epTitle, fr.id);
          seenFiles.add(fr.id);
        } else {
          const fid = Number(insFile.run(f.path, f.name, f.size, f.ext, id, f.season, f.episode, f.explicit ? 1 : 0, f.epTitle).lastInsertRowid);
          seenFiles.add(fid);
        }
      }
    }
    for (const { id } of db.prepare('SELECT id FROM files').all()) if (!seenFiles.has(id)) db.prepare('DELETE FROM files WHERE id=?').run(id);
    for (const { id } of db.prepare('SELECT id FROM titles').all()) if (!seenTitles.has(id)) db.prepare('DELETE FROM titles WHERE id=?').run(id);
  });
}

export function getOverrides() {
  const o = {};
  for (const r of db.prepare('SELECT path, mode FROM overrides').all()) o[r.path] = r.mode;
  return o;
}

export async function runScan(log = console.log) {
  if (scanState.running) return scanState;
  if (!seafileConfigured()) {
    scanState.error = 'SEAFILE_URL non configurato';
    return scanState;
  }
  Object.assign(scanState, { running: true, startedAt: Date.now(), error: null, files: 0 });
  try {
    const { dirs, files } = await crawl((n) => { scanState.files = n; });
    const videos = files.filter((f) => isVideo(f.path));
    const items = classify(dirs, videos, getOverrides());
    applyScan(items);
    applyAllSagas();
    scanState.titles = items.length;
    scanState.files = videos.length;
    log(`Scansione: ${videos.length} video, ${items.length} titoli`);
    scanState.finishedAt = Date.now();
  } catch (e) {
    scanState.error = e.message;
    log('Scansione fallita: ' + e.message);
  } finally {
    scanState.running = false;
  }
  fetchPendingMetadata(log).catch((e) => log('TMDB: ' + e.message));
  return scanState;
}
