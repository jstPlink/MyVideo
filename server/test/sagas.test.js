import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRulesText, seasonFor, presetFor, rulesToText, PRESETS } from '../src/sagas.js';

test('testo -> regole ordinate', () => {
  const r = parseRulesText('19 Saga di Freezer\n1 - Saga dei Saiyan\n\nxx ignorata\n55: Androidi');
  assert.deepEqual(r.map((x) => x.from), [1, 19, 55]);
  assert.equal(r[1].name, 'Saga di Freezer');
  assert.equal(parseRulesText(rulesToText(r)).length, 3);
});

test('stagione di un episodio', () => {
  const r = parseRulesText('1 A\n19 B\n55 C');
  assert.equal(seasonFor(r, 1), 1);
  assert.equal(seasonFor(r, 18), 1);
  assert.equal(seasonFor(r, 19), 2);
  assert.equal(seasonFor(r, 159), 3);
  assert.equal(seasonFor([], 5), 1);
});

test('preset per nome serie', () => {
  assert.equal(presetFor('Dragn Ball Kai').label, 'Dragon Ball Kai');
  assert.equal(presetFor('Dragon Ball Super').label, 'Dragon Ball Super');
  assert.equal(presetFor('Dragon Ball GT').label, 'Dragon Ball GT');
  assert.equal(presetFor('Dragon Ball').label, 'Dragon Ball (serie originale)');
  assert.equal(presetFor('Dragon Ball Heroes'), null);
  assert.equal(presetFor('Dragon Ball Daima'), null);
  assert.equal(presetFor('How i met your mother'), null);
  for (const p of PRESETS) assert.equal(p.rules[0].from, 1);
});
