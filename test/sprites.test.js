// Pixel sprites (src/app/pixel/sprites.js) are well-formed text maps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_SPRITES, SPRITE_KEYS, UNITS, FOOT_ROW } from '../src/app/pixel/sprites.js';
import { UnitTypes } from '../src/engine/index.js';

test('every sprite is rectangular and uses only known pixel keys', () => {
  for (const [name, rows] of Object.entries(ALL_SPRITES)) {
    assert.ok(rows.length > 0, name);
    for (const row of rows) {
      assert.equal(row.length, rows[0].length, `${name}: ragged row "${row}"`);
      for (const ch of row) assert.ok(SPRITE_KEYS.has(ch), `${name}: unknown key "${ch}"`);
    }
  }
});

test('unit sprites share one size with feet on the same row; every unit type has one', () => {
  for (const [name, rows] of Object.entries(UNITS)) {
    assert.equal(rows.length, 22, name);
    assert.equal(rows[0].length, 15, name);
    assert.ok(/[^.]/.test(rows[FOOT_ROW]), `${name}: feet on row ${FOOT_ROW}`);
    assert.ok(!/[^.]/.test(rows[FOOT_ROW + 1]), `${name}: nothing below the feet`);
  }
  for (const key of Object.keys(UnitTypes)) assert.ok(UNITS[key], `sprite for ${key}`);
});
