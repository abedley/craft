// Hex grid geometry (flat-topped hexes, odd-q offset coordinates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, nextStep, step, distance, neighbors, OPPOSITE, ALL_DIRECTIONS } from '../src/engine/index.js';

test('six neighbours, which depend on column parity', () => {
  assert.deepEqual(neighbors(2, 2).map(([d, x, y]) => [d, x, y]), [
    ['up', 2, 1], ['up-right', 3, 1], ['down-right', 3, 2], ['down', 2, 3], ['down-left', 1, 2], ['up-left', 1, 1],
  ]);
  assert.deepEqual(neighbors(3, 2).map(([d, x, y]) => [d, x, y]), [
    ['up', 3, 1], ['up-right', 4, 2], ['down-right', 4, 3], ['down', 3, 3], ['down-left', 2, 3], ['up-left', 2, 2],
  ]);
});

test('every neighbour is 1 away and stepping back returns to the start', () => {
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      for (const dir of ALL_DIRECTIONS) {
        const [nx, ny] = step(x, y, dir);
        assert.equal(distance(x, y, nx, ny), 1);
        assert.deepEqual(step(nx, ny, OPPOSITE[dir]), [x, y]);
      }
    }
  }
});

test('distance is symmetric and matches known values', () => {
  assert.equal(distance(0, 0, 0, 5), 5); // straight down a column
  assert.equal(distance(0, 0, 3, 3), 5);
  assert.equal(distance(0, 0, 4, 2), 4); // straight down-right line
  assert.equal(distance(3, 3, 0, 0), distance(0, 0, 3, 3));
});

test('units always reach their target in the fewest steps without leaving the board', () => {
  const board = { width: 8, height: 8 };
  for (let ax = 0; ax < 8; ax++) {
    for (let ay = 0; ay < 8; ay++) {
      for (let bx = 0; bx < 8; bx++) {
        for (let by = 0; by < 8; by++) {
          let u = { x: ax, y: ay, order: { type: 'move', x: bx, y: by } };
          let steps = 0;
          while ((u.x !== bx || u.y !== by) && steps < 20) {
            const n = nextStep(u, board);
            assert.equal(distance(u.x, u.y, n.x, n.y), 1);
            assert.ok(n.x >= 0 && n.y >= 0 && n.x < 8 && n.y < 8);
            u = { ...u, ...n };
            steps++;
          }
          assert.equal(steps, distance(ax, ay, bx, by));
        }
      }
    }
  }
});

test('state is marked as hex; square-grid saves are rejected with a clear error', () => {
  const g = new Game({ width: 3, height: 3 });
  assert.equal(g.snapshot().grid, 'hex');
  const square = { width: 3, height: 3, tick: 0, nextUnitId: 1, units: [], queue: [] };
  assert.throws(() => Game.fromSnapshot(square), /square-grid/);
});
