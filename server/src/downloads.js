// Elenco dei file scaricabili (APK Android e installer desktop) dalle release GitHub.
// Il sito mostra i link diretti ai file della release: il NAS non fa da proxy a file da 100+ MB.
import express from 'express';

const REPO = process.env.GITHUB_REPO || 'jstPlink/MyVideo';
const TTL = 10 * 60 * 1000;

let cache = { at: 0, data: null };

const ORDER = ['android', 'windows', 'mac', 'linux'];

export function classifyAsset(name) {
  if (/\.apk$/i.test(name)) return 'android';
  if (/\.exe$/i.test(name) && !/uninstaller/i.test(name)) return 'windows';
  if (/\.dmg$/i.test(name)) return 'mac';
  if (/\.AppImage$/i.test(name)) return 'linux';
  return null;
}

export function archOf(name) {
  const m = name.match(/(arm64|aarch64|x86_64|x64|universal|ia32)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Per ogni piattaforma tiene l'asset della release piu' recente che lo contiene. */
export function pickAssets(releases) {
  const picked = new Map();
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    for (const a of r.assets || []) {
      const kind = classifyAsset(a.name);
      if (!kind) continue;
      const arch = archOf(a.name);
      const key = `${kind}:${arch || ''}`;
      if (picked.has(key)) continue;
      picked.set(key, {
        kind, arch, name: a.name, size: a.size, url: a.browser_download_url,
        version: String(r.tag_name || '').replace(/^v/, ''), publishedAt: r.published_at,
      });
    }
  }
  return [...picked.values()].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || String(a.arch).localeCompare(String(b.arch)));
}

async function load() {
  if (cache.data && Date.now() - cache.at < TTL) return cache.data;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=12`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MyVideo-server' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`GitHub HTTP ${r.status}`);
    const releases = await r.json();
    const data = {
      repo: REPO,
      releasesUrl: `https://github.com/${REPO}/releases`,
      latest: releases.find((x) => !x.draft && !x.prerelease)?.tag_name?.replace(/^v/, '') || null,
      assets: pickAssets(releases),
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (e) {
    if (cache.data) return cache.data; // meglio un elenco vecchio che nessun elenco
    throw e;
  }
}

export const downloadsRouter = express.Router();

// Pubblico: i file sono gia' pubblici su GitHub e la pagina serve anche prima del login.
downloadsRouter.get('/', async (req, res) => {
  try {
    res.json(await load());
  } catch (e) {
    res.status(502).json({ error: 'Elenco non disponibile al momento', releasesUrl: `https://github.com/${REPO}/releases` });
  }
});
