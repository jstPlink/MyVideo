import test from 'node:test';
import assert from 'node:assert/strict';
import { distribute, localParts, rangeBounds, csvCell, csvRow } from '../src/watch.js';

const sum = (a) => a.reduce((x, y) => x + y.seconds, 0);

test('distribuzione dei secondi nelle ore', () => {
  // 22:30 -> 00:30 UTC (2 ore), 7200 s: 1800 alle 22, 3600 alle 23, 1800 alle 00 del giorno dopo
  const start = Date.UTC(2026, 10, 7, 22, 30);
  const end = Date.UTC(2026, 10, 8, 0, 30);
  const r = distribute(start, end, 7200, 0);
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((x) => [x.day, x.hour, Math.round(x.seconds)]), [['2026-11-07', 22, 1800], ['2026-11-07', 23, 3600], ['2026-11-08', 0, 1800]]);
  assert.equal(Math.round(sum(r)), 7200);
});

test('distribuzione con fuso orario', () => {
  // client UTC+1 (offset -60): 23:30 UTC = 00:30 locale del giorno dopo
  const t = Date.UTC(2026, 10, 7, 23, 30);
  assert.deepEqual(localParts(t, -60), { day: '2026-11-08', hour: 0, weekday: 0 });
  const r = distribute(t - 60000, t, 60, -60);
  assert.equal(r.length, 1);
  assert.equal(r[0].day, '2026-11-08');
});

test('intervallo vuoto: tutto in un solo bucket', () => {
  const t = Date.UTC(2026, 0, 1, 12, 0);
  const r = distribute(t, t, 10, 0);
  assert.equal(r.length, 1);
  assert.equal(r[0].seconds, 10);
});

test('inizio periodo', () => {
  const now = Date.UTC(2026, 10, 7, 15, 0);
  assert.equal(rangeBounds('7d', 0, now).fromDay, '2026-11-01');
  assert.equal(rangeBounds('30d', 0, now).fromDay, '2026-10-09');
  assert.equal(rangeBounds('all', 0, now).days, null);
});

test('csv: virgolette e separatori', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('dice "ciao"'), '"dice ""ciao"""');
  assert.equal(csvRow(['x', 1, null]), 'x,1,');
});
