import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

function readVersion() {
  for (const p of [env.VERSION_FILE, path.resolve(here, '../../VERSION'), path.resolve(here, '../VERSION')]) {
    if (!p) continue;
    try { return fs.readFileSync(p, 'utf8').trim(); } catch { /* next */ }
  }
  return '0.0.0';
}

export const config = {
  version: readVersion(),
  port: Number(env.PORT || 8080),
  dataDir: path.resolve(env.DATA_DIR || path.join(here, '../../data')),
  webDir: path.resolve(env.WEB_DIR || path.join(here, '../../web/dist')),
  seafileUrl: env.SEAFILE_URL || '',
  tmdbKey: env.TMDB_API_KEY || '',
  registration: ['approval', 'open', 'closed'].includes(env.REGISTRATION) ? env.REGISTRATION : 'approval',
  jwtSecret: env.JWT_SECRET || '',
  scanIntervalHours: Number(env.SCAN_INTERVAL_HOURS ?? 12),
};
