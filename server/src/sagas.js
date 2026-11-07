// Saghe / stagioni personalizzate per le serie numerate in modo assoluto (es. Dragon Ball: episodi 1..159).
// Una regola = "da questo episodio inizia questa stagione/saga"; dura fino alla regola successiva.
import { db, tx } from './db.js';

/** Regole predefinite, riconosciute dal nome della serie. Intervalli da Wikipedia, modificabili dall'Admin. */
export const PRESETS = [
  {
    label: 'Dragon Ball Kai',
    match: /\bkai\b/i,
    rules: [
      { from: 1, name: 'Saga dei Saiyan' },
      { from: 19, name: 'Saga di Freezer' },
      { from: 55, name: 'Saga degli Androidi e di Cell' },
      { from: 83, name: 'Saga dei Giochi di Cell' },
      { from: 99, name: 'Saga del Torneo Mondiale' },
      { from: 116, name: 'Saga di Majin Bu' },
      { from: 134, name: 'Saga del Bu Malvagio' },
    ],
  },
  {
    label: 'Dragon Ball Super',
    match: /\bsuper\b/i,
    notMatch: /heroes/i,
    rules: [
      { from: 1, name: 'Saga del Dio della Distruzione Beerus' },
      { from: 19, name: 'Saga di Freezer Dorato' },
      { from: 28, name: 'Saga dell\'Universo 6' },
      { from: 47, name: 'Saga di Goku Black e Zamasu' },
      { from: 77, name: 'Saga della Sopravvivenza dell\'Universo' },
    ],
  },
  {
    label: 'Dragon Ball GT',
    match: /\bgt\b/i,
    rules: [
      { from: 1, name: 'Saga delle Sfere del Drago della Stella Nera' },
      { from: 17, name: 'Saga di Baby' },
      { from: 41, name: 'Saga di Super C-17' },
      { from: 48, name: 'Saga dei Draghi Malvagi' },
    ],
  },
  {
    label: 'Dragon Ball (serie originale)',
    match: /^dragon ?ball$/i,
    rules: [
      { from: 1, name: 'Saga dell\'Imperatore Pilaf' },
      { from: 14, name: 'Saga del Torneo Tenkaichi' },
      { from: 29, name: 'Saga del Red Ribbon' },
      { from: 46, name: 'Saga del Generale Blue' },
      { from: 58, name: 'Saga del Comandante Red' },
      { from: 69, name: 'Saga della Maga Baba' },
      { from: 84, name: 'Saga di Tenshinhan' },
      { from: 102, name: 'Saga di Re Piccolo' },
      { from: 123, name: 'Saga di Piccolo Jr.' },
    ],
  },
];

export function presetFor(name) {
  const n = (name || '').trim();
  return PRESETS.find((p) => p.match.test(n) && !(p.notMatch && p.notMatch.test(n))) || null;
}

/** Testo (una regola per riga: "<episodio iniziale> <nome>") -> regole ordinate. */
export function parseRulesText(text) {
  const rules = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.trim().match(/^(\d{1,4})\s*[-:|.)]?\s*(.+)$/);
    if (m) rules.push({ from: Number(m[1]), name: m[2].trim() });
  }
  rules.sort((a, b) => a.from - b.from);
  return rules;
}

export const rulesToText = (rules) => rules.map((r) => `${r.from} ${r.name}`).join('\n');

/** Numero di stagione (1..n) di un episodio in base alle regole. */
export function seasonFor(rules, episode) {
  let idx = 0;
  for (let i = 0; i < rules.length; i++) if (rules[i].from <= episode) idx = i;
  return idx + 1;
}

function getRules(key) {
  const row = db.prepare('SELECT rules FROM saga_rules WHERE title_key = ?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.rules); } catch { return []; }
}

/** Applica le regole di una serie ai suoi file (solo episodi senza numerazione stagione esplicita). */
export function applyRules(titleId) {
  const t = db.prepare("SELECT id, key FROM titles WHERE id = ? AND kind = 'series'").get(titleId);
  if (!t) return;
  const rules = getRules(t.key);
  if (rules === null) return; // nessuna regola: le stagioni restano quelle decise dalla scansione
  tx(() => {
    db.prepare('DELETE FROM seasons WHERE title_id = ?').run(t.id);
    if (!rules.length) {
      db.prepare('UPDATE files SET season = 1 WHERE title_id = ? AND explicit = 0').run(t.id);
      return;
    }
    const upd = db.prepare('UPDATE files SET season = ? WHERE id = ?');
    for (const f of db.prepare('SELECT id, episode FROM files WHERE title_id = ? AND explicit = 0').all(t.id)) {
      upd.run(seasonFor(rules, f.episode ?? 1), f.id);
    }
    const ins = db.prepare('INSERT INTO seasons(title_id, season, name) VALUES(?,?,?)');
    rules.forEach((r, i) => ins.run(t.id, i + 1, r.name));
  });
}

/** Dopo ogni scansione: assegna i preset alle serie senza regole e applica tutte le regole. */
export function applyAllSagas() {
  const series = db.prepare("SELECT id, key, name FROM titles WHERE kind = 'series'").all();
  const ins = db.prepare("INSERT OR IGNORE INTO saga_rules(title_key, rules, source) VALUES(?,?,'preset')");
  for (const t of series) {
    if (!db.prepare('SELECT 1 FROM saga_rules WHERE title_key = ?').get(t.key)) {
      const p = presetFor(t.name);
      if (p) ins.run(t.key, JSON.stringify(p.rules));
    }
    applyRules(t.id);
  }
}

export function saveRules(titleId, rules, source = 'custom') {
  const t = db.prepare("SELECT key FROM titles WHERE id = ? AND kind = 'series'").get(titleId);
  if (!t) return false;
  db.prepare('INSERT INTO saga_rules(title_key, rules, source) VALUES(?,?,?) ON CONFLICT(title_key) DO UPDATE SET rules=excluded.rules, source=excluded.source')
    .run(t.key, JSON.stringify(rules), source);
  applyRules(titleId);
  return true;
}

export function resetRules(titleId) {
  const t = db.prepare("SELECT key, name FROM titles WHERE id = ? AND kind = 'series'").get(titleId);
  if (!t) return false;
  db.prepare('DELETE FROM saga_rules WHERE title_key = ?').run(t.key);
  const p = presetFor(t.name);
  if (p) db.prepare("INSERT INTO saga_rules(title_key, rules, source) VALUES(?,?,'preset')").run(t.key, JSON.stringify(p.rules));
  applyRules(titleId);
  return true;
}

export function sagaList() {
  return db.prepare("SELECT id, key, name FROM titles WHERE kind = 'series' ORDER BY name COLLATE NOCASE").all().map((t) => {
    const rules = getRules(t.key);
    const stats = db.prepare('SELECT COUNT(*) AS n, MAX(episode) AS max FROM files WHERE title_id = ?').get(t.id);
    const row = db.prepare('SELECT source FROM saga_rules WHERE title_key = ?').get(t.key);
    return {
      id: t.id, name: t.name, episodes: stats.n, maxEpisode: stats.max,
      text: rules ? rulesToText(rules) : '', source: row?.source || null,
      presetAvailable: !!presetFor(t.name),
    };
  });
}
