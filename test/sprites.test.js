// Colour pixel sprites (src/app/pixel/sprites.js), built in code on a pixel grid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SpriteBuilder, buildUnit, buildTree, buildMine, buildGoalFlag, buildStar, buildDies, buildBullet,
  UNIT_W, UNIT_H, FOOT_ROW, UNIT_TYPES_DRAWN,
} from '../src/app/pixel/sprites.js';
import { C, TEAM, OUTLINE } from '../src/app/pixel/palette.js';
import { UnitTypes } from '../src/engine/index.js';

const PALETTE = new Set([
  ...Object.values(C).flatMap((v) => (Array.isArray(v) ? v : [v])),
  ...Object.values(TEAM).flatMap((t) => Object.values(t)),
  '#1b1420', '#ff6b5c', // hood shadow, dies-plate highlight
]);

const sprites = () => [
  ...['player', 'cpu'].flatMap((team) => [...UNIT_TYPES_DRAWN, 'generic'].map((type) => [`${type}/${team}`, buildUnit(type, team)])),
  ['tree0', buildTree(0)], ['tree1', buildTree(1)], ['mine', buildMine('cpu')], ['goal', buildGoalFlag()],
  ['star', buildStar()], ['dies', buildDies()], ['bullet', buildBullet()],
];

test('every sprite uses palette colours only, and is fully outlined', () => {
  for (const [name, s] of sprites()) {
    for (const c of s.colors()) assert.ok(PALETTE.has(c), `${name}: off-palette colour ${c}`);
    // No filled, non-outline pixel touches empty space: the outline wraps everything.
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const c = s.get(x, y);
        if (!c || c === OUTLINE) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const inside = x + dx >= 0 && y + dy >= 0 && x + dx < s.w && y + dy < s.h;
          if (inside) assert.ok(s.get(x + dx, y + dy) !== null, `${name}: pixel ${x},${y} not outlined`);
        }
      }
    }
  }
});

test('unit sprites share one size, stand on the foot row, and differ by team', () => {
  for (const type of [...UNIT_TYPES_DRAWN, 'generic']) {
    const s = buildUnit(type, 'player');
    assert.equal(s.w, UNIT_W);
    assert.equal(s.h, UNIT_H);
    const row = (y) => Array.from({ length: s.w }, (_, x) => s.get(x, y));
    assert.ok(row(FOOT_ROW).some(Boolean), `${type}: feet on row ${FOOT_ROW}`);
    for (let y = FOOT_ROW + 1; y < s.h; y++) assert.ok(!row(y).some(Boolean), `${type}: nothing below the feet`);
    assert.ok(s.colors().has(TEAM.player.main) || s.colors().has(TEAM.player.dark), `${type}: wears team colours`);
    assert.ok(buildUnit(type, 'cpu').colors().has(TEAM.cpu.dark), `${type}: CPU colours`);
  }
  for (const key of Object.keys(UnitTypes)) assert.ok(UNIT_TYPES_DRAWN.includes(key), `sprite for ${key}`);
});

test('the sprite builder fills shapes on whole pixels', () => {
  const s = new SpriteBuilder(10, 10).rect(2, 2, 3, 3, 'a').ellipse(7, 7, 2, 2, 'b').line(0, 9, 9, 9, 'c');
  assert.equal(s.get(2, 2), 'a');
  assert.equal(s.get(5, 5), null);
  assert.equal(s.get(6, 6), 'b');
  assert.equal(s.get(4, 9), 'c');
  s.outline('o');
  assert.equal(s.get(1, 2), 'o');
  assert.equal(s.get(0, 0), null);
});
