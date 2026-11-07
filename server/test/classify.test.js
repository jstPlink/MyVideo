import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classify } from '../src/classify.js';

const f = (p, size = 1) => ({ path: p, size });

test('serie a stagioni, serie episodica, film', () => {
  const dirs = ['/Show', '/Show/Show S01', '/Show/Show S02', '/Dragon', '/Dragon/Dragon Super', '/Film', '/Film/Shrek'];
  const files = [
    f('/Show/Show S01/Show.1x01.Uno.avi'), f('/Show/Show S01/Show.1x02.Due.avi'),
    f('/Show/Show S02/Show.2x01.Tre.avi'),
    f('/Dragon/Dragon Super/Dragon Super 001 ITA.mp4'), f('/Dragon/Dragon Super/Dragon Super 002 ITA.mp4'), f('/Dragon/Dragon Super/Dragon Super 003 ITA.mp4'),
    f('/Film/Avengers 2018.mp4'), f('/Film/Shrek/Shrek.mp4'), f('/Film/Shrek/note.txt'),
  ];
  const t = classify(dirs, files);
  const show = t.find((x) => x.key === 'S:/Show/');
  assert.equal(show.kind, 'series');
  assert.equal(show.name, 'Show');
  assert.equal(show.files.length, 3);
  assert.deepEqual(show.files.map((x) => [x.season, x.episode]), [[1, 1], [1, 2], [2, 1]]);
  const dr = t.find((x) => x.key === 'S:/Dragon/Dragon Super/');
  assert.equal(dr.kind, 'series');
  assert.equal(dr.grp, 'Dragon');
  assert.equal(dr.files.length, 3);
  const mv = t.filter((x) => x.kind === 'movie');
  assert.deepEqual(mv.map((x) => x.name).sort(), ['Avengers', 'Shrek']);
  assert.equal(mv.find((x) => x.name === 'Avengers').year, 2018);
});

test('cartelle di film non diventano serie', () => {
  const dirs = ['/Pokemon', '/Film'];
  const files = [
    f('/Pokemon/01 - Mewtwo contro Mew- byR02.mp4'), f('/Pokemon/02 - La forza di uno - byR02.mp4'),
    f('/Pokemon/03 - Unown - byGP97.mp4'), f('/Pokemon/04 - 4Ever - byGP97.mp4'),
    f('/Film/Pirati dei Caraibi - A - 2003.mp4'), f('/Film/Pirati dei Caraibi - B - 2006.mp4'),
    f('/Film/Pirati dei Caraibi - C - 2007.mp4'), f('/Film/Pirati dei Caraibi - D - 2011.mp4'),
    f('/Film/Pirati dei Caraibi - E - 2017.mp4'),
  ];
  const t = classify(dirs, files);
  assert.equal(t.filter((x) => x.kind === 'series').length, 0);
  assert.equal(t.length, 9);
});

test('puntate con titolo e prefisso comune', () => {
  const dirs = ['/Reality', '/Reality/Missione'];
  const names = ['Un Milione', 'A Tisket', 'Amo il Rock', 'Bahamarama', 'Blues', 'Ca-Nooding'];
  const files = names.map((n) => f(`/Reality/Missione/Missione Cosmo Ridicola - ${n}.mp4`));
  const t = classify(dirs, files);
  assert.equal(t.length, 1);
  assert.equal(t[0].kind, 'series');
  assert.equal(t[0].files.length, 6);
});

test('override', () => {
  const dirs = ['/Film'];
  const files = [f('/Film/a 2000.mp4'), f('/Film/b 2001.mp4')];
  assert.equal(classify(dirs, files, { '/Film/': 'series' })[0].kind, 'series');
  assert.equal(classify(dirs, files, { '/Film/': 'ignore' }).length, 0);
});

test('libreria reale (se disponibile)', { skip: !process.env.TREE_JSON }, () => {
  const tree = JSON.parse(fs.readFileSync(process.env.TREE_JSON, 'utf8'));
  const files = tree.map(([path, size]) => ({ path, size }));
  const dirs = [...new Set(files.map((x) => x.path.slice(0, x.path.lastIndexOf('/'))).filter(Boolean))];
  const all = new Set();
  for (const d of dirs) { const parts = d.split('/').filter(Boolean); for (let i = 1; i <= parts.length; i++) all.add('/' + parts.slice(0, i).join('/')); }
  const t = classify([...all], files);
  const series = t.filter((x) => x.kind === 'series');
  console.log(series.map((s) => `${s.name} [${s.grp}] ${s.files.length}`).join('\n'));
  console.log('film:', t.length - series.length);
});

test('cartelle accorpate in una serie con stagioni', () => {
  const dirs = ['/Reality', '/Reality/Reality - Azione', '/Reality/Reality - L\'isola', '/Reality/Reality - All stars'];
  const files = [
    f('/Reality/Reality - Azione/Reality Azione - Episodio 1.mp4'), f('/Reality/Reality - Azione/Reality Azione - Episodio 2.mp4'),
    f('/Reality/Reality - L\'isola/Reality Isola - Episodio 1.mp4'),
    f('/Reality/Reality - All stars/5x01 Reality.mp4'),
  ];
  const ov = { '/Reality/': { mode: 'seasons', data: ["L'isola", 'Azione', 'All stars'] } };
  const t = classify(dirs, files, ov);
  assert.equal(t.length, 1);
  assert.equal(t[0].name, 'Reality');
  assert.deepEqual(t[0].seasonNames.map((s) => s.name), ["L'isola", 'Azione', 'All stars']);
  assert.deepEqual(t[0].files.map((x) => [x.season, x.episode]).sort(), [[1, 1], [2, 1], [2, 2], [3, 1]]);
  // senza ordine: alfabetico
  const t2 = classify(dirs, files, { '/Reality/': { mode: 'seasons', data: [] } });
  assert.deepEqual(t2[0].seasonNames.map((s) => s.name), ['All stars', 'Azione', "L'isola"]);
});
