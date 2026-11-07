// Uso: node scripts/bump-version.mjs <x.y.z>
// Allinea VERSION, server/package.json, web/package.json e desktop/package.json (e i relativi lock file).
import fs from 'node:fs';

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || '')) {
  console.error('Uso: node scripts/bump-version.mjs <x.y.z>');
  process.exit(1);
}
fs.writeFileSync('VERSION', v + '\n');
for (const dir of ['server', 'web', 'desktop']) {
  for (const f of ['package.json', 'package-lock.json']) {
    const p = `${dir}/${f}`;
    if (!fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.version = v;
    if (j.packages?.['']) j.packages[''].version = v;
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  }
}
console.log('Versione impostata a', v, '- ora aggiungi la sezione al CHANGELOG e aggiorna docs/.');
