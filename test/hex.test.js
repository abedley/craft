// Hex grid geometry (pointy-topped hexes, odd-r offset coordinates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, nextStep, step, distance, neighbors, OPPOSITE, ALL_DIRECTIONS, DIRECTION_ANGLES, toAxial, fromAxial, hexLineStep,
} from '../src/engine/index.js';

test('six neighbours, which depend on row parity (odd rows are shifted right)', () => {
  assert.deepEqual(neighbors(2, 2).map(([d, x, y]) => [d, x, y]), [
    ['up-left', 1, 1], ['up-right', 2, 1], ['right', 3, 2], ['down-right', 2, 3], ['down-left', 1, 3], ['left', 1, 2],
  ]);
  assert.deepEqual(neighbors(2, 3).map(([d, x, y]) => [d, x, y]), [
    ['up-left', 2, 2], ['up-right', 3, 2], ['right', 3, 3], ['down-right', 3, 4], ['down-left', 2, 4], ['left', 1, 3],
  ]);
});

test('offset <-> axial round-trips on both row parities; there is no straight up or down', () => {
  for (let x = -3; x < 8; x++) {
    for (let y = -3; y < 8; y++) assert.deepEqual(fromAxial(...toAxial(x, y)), [x, y]);
  }
  assert.deepEqual(ALL_DIRECTIONS, ['up-left', 'up-right', 'right', 'down-right', 'down-left', 'left']);
  assert.equal(ALL_DIRECTIONS.includes('up'), false);
  assert.equal(OPPOSITE.left, 'right');
  assert.equal(OPPOSITE['up-left'], 'down-right');
  assert.equal(OPPOSITE['up-right'], 'down-left');
  // Screen angles point from a hex centre to its neighbour's (pointy-top layout).
  const center = (x, y) => [Math.sqrt(3) * (x + 0.5 * (y & 1)), 1.5 * y];
  for (const y of [2, 3]) {
    for (const dir of ALL_DIRECTIONS) {
      const [ax, ay] = center(2, y);
      const [bx, by] = center(...step(2, y, dir));
      const a = DIRECTION_ANGLES[dir];
      assert.ok(Math.abs(Math.cos(a) - (bx - ax) / Math.sqrt(3)) < 1e-9 && Math.abs(Math.sin(a) - (by - ay) / Math.sqrt(3)) < 1e-9, `${dir} from row ${y}`);
    }
  }
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
  assert.equal(distance(0, 0, 5, 0), 5); // straight along a row
  assert.equal(distance(0, 0, 3, 3), 5);
  assert.equal(distance(0, 0, 2, 4), 4); // straight down-right line
  assert.equal(distance(0, 0, 0, 4), 4); // a column zigzags, but it's still 4 steps
  // A straight line runs through opposite sides.
  let p = [0, 0];
  for (let k = 0; k < 4; k++) p = hexLineStep(...p, 2, 4);
  assert.deepEqual(p, [2, 4]);
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

test('state is marked as pointy-top hex; older grids are rejected with a clear error', () => {
  const g = new Game({ width: 3, height: 3 });
  assert.equal(g.snapshot().grid, 'hex-r');
  const square = { width: 3, height: 3, tick: 0, nextUnitId: 1, units: [], queue: [] };
  assert.throws(() => Game.fromSnapshot(square), /square-grid/);
  const flat = { ...square, grid: 'hex', queueVersion: 2 };
  assert.throws(() => Game.fromSnapshot(flat), /flat-topped hex version/);
});
