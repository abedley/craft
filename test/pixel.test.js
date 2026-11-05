// Pixel-art board geometry (src/app/pixel/grid.js): masks tile exactly,
// every hex picks back to itself, and directions snap correctly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PixelView, MASK, W, H, V, inMask, BUILDING_HEIGHT, ELEVATION, elevationOf } from '../src/app/pixel/grid.js';
import { scenarios } from '../src/scenarios.js';
import { Game, step, ALL_DIRECTIONS } from '../src/engine/index.js';
import { nearestDirection } from '../src/app/shared.js';

test('the hex mask is symmetric and tiles a flat board with no gaps or overlaps', () => {
  assert.equal(MASK.length, H);
  for (let r = 0; r < H; r++) {
    const [x0, x1] = MASK[r];
    assert.equal(x0, W - x1, `row ${r} is centred`);
    assert.deepEqual(MASK[r], MASK[H - 1 - r], `row ${r} mirrors row ${H - 1 - r}`);
  }
  // Every pixel well inside a flat 6x6 board belongs to exactly one hex.
  const g = new Game({ width: 6, height: 6 });
  const v = new PixelView(g);
  const owners = new Map();
  for (const [x, y] of v.drawOrder()) {
    const [ox, oy] = v.origin(x, y);
    for (let r = 0; r < H; r++) {
      for (let c = MASK[r][0]; c < MASK[r][1]; c++) {
        const k = `${ox + c},${oy + r}`;
        owners.set(k, (owners.get(k) ?? 0) + 1);
      }
    }
  }
  const [x0, y0] = v.origin(1, 1);
  const [x1, y1] = v.origin(4, 4);
  for (let ay = y0; ay < y1; ay++) {
    for (let ax = x0; ax < x1; ax++) assert.equal(owners.get(`${ax},${ay}`), 1, `pixel ${ax},${ay}`);
  }
});

test('every hex picks back to itself at its top-face centre, on the scenario maps', () => {
  for (const name of ['Escort the builder', 'Big battle (12x14)', 'Small skirmish (5x6)']) {
    const g = scenarios[name]();
    const v = new PixelView(g);
    for (const [x, y] of v.drawOrder()) {
      const [cx, cy] = v.center(x, y, v.standHeight(x, y));
      assert.deepEqual(v.pick(cx, cy), { x, y }, `${name}: ${x},${y}`);
      const [ox, oy] = v.origin(x, y);
      // Down its middle too, except the bottom tip, which a higher hex in front may cover.
      for (let r = 0; r < H - 8; r += 2) assert.deepEqual(v.pick(ox + W / 2, oy + r), { x, y }, `${name}: ${x},${y} row ${r}`);
    }
    const { w, h } = v.size;
    assert.equal(v.pick(0, 0), null);
    assert.equal(v.pick(w - 1, h - 1), null);
  }
});

test('a building lifts the hex: its roof picks the hex, units stand on it', () => {
  const g = new Game({ width: 3, height: 3, units: [{ x: 1, y: 1 }] });
  g.state.buildings.push({ id: 1, x: 1, y: 1, team: 'player', builderId: 1 });
  const v = new PixelView(g);
  assert.equal(v.standHeight(1, 1), v.groundHeight(1, 1) + BUILDING_HEIGHT);
  assert.deepEqual(v.pick(...v.center(1, 1, v.standHeight(1, 1))), { x: 1, y: 1 });
});

test('heights are whole pixels; water sits low; off-board is grass height', () => {
  assert.ok(ELEVATION.water < ELEVATION.grass);
  assert.equal(elevationOf('no-such-type'), 9);
  const v = new PixelView(new Game({ width: 2, height: 2 }));
  assert.equal(v.groundHeight(-1, 5), ELEVATION.grass);
  for (const [x, y] of [[0, 0], [1, 1]]) assert.ok(v.center(x, y).every(Number.isInteger));
  assert.equal(V, 21);
});

test('tapping two hexes out along each direction snaps to that direction', () => {
  const g = new Game({ width: 7, height: 7, units: [{ x: 3, y: 3 }] });
  const v = new PixelView(g);
  const u = g.getUnit(1);
  const center = (x, y) => v.center(x, y);
  for (const dir of ALL_DIRECTIONS) {
    const [tx, ty] = step(...step(3, 3, dir), dir);
    assert.equal(nearestDirection(center, u, tx, ty, ALL_DIRECTIONS), dir);
  }
  for (const [x, y] of [[0, 0], [6, 6], [3, 0]]) assert.equal(typeof inMask(x, y), 'boolean');
});
