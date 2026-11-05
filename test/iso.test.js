// The isometric view used by the game UI (src/app/iso.js): projection,
// fitting and picking hexes from screen points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IsoView, terrainHeight, TERRAIN_HEIGHT, BUILDING_HEIGHT, pointInPolygon } from '../src/app/iso.js';
import { scenarios } from '../src/scenarios.js';
import { Game, Teams } from '../src/engine/index.js';

test('every hex picks back to itself, at its top face, on the scenario maps', () => {
  for (const name of ['Escort the builder', 'Big battle (12x14)', 'Small skirmish (5x6)']) {
    const g = scenarios[name]();
    const v = new IsoView(g);
    v.fit(390, 420);
    for (let x = 0; x < g.width; x++) {
      for (let y = 0; y < g.height; y++) {
        const [sx, sy] = v.center(x, y, v.standHeight(x, y));
        assert.deepEqual(v.pick(sx, sy), { x, y }, `${name}: hex ${x},${y}`);
      }
    }
  }
});

test('picking still works zoomed in and panned, and off the board is null', () => {
  const g = scenarios['Escort the builder']();
  const v = new IsoView(g);
  v.fit(390, 420);
  v.zoomAt(2, 100, 120);
  v.panBy(-40, 25);
  for (const [x, y] of [[0, 0], [7, 9], [3, 4], [6, 1]]) {
    const [sx, sy] = v.center(x, y);
    assert.deepEqual(v.pick(sx, sy), { x, y });
  }
  v.resetCamera();
  assert.equal(v.pick(-50, -50), null);
});

test('a building lifts the hex: its roof picks the hex, units stand on it', () => {
  const g = new Game({ width: 3, height: 3, units: [{ x: 1, y: 1, team: Teams.PLAYER }] });
  g.state.buildings.push({ id: 1, x: 1, y: 1, team: Teams.PLAYER, builderId: 1 });
  const v = new IsoView(g);
  v.fit(300, 300);
  assert.equal(v.standHeight(1, 1), v.groundHeight(1, 1) + BUILDING_HEIGHT);
  const [sx, sy] = v.center(1, 1, v.standHeight(1, 1));
  assert.deepEqual(v.pick(sx, sy), { x: 1, y: 1 });
});

test('the board fits the viewport, centred, and zoom is clamped', () => {
  const g = scenarios['Escort the builder']();
  const v = new IsoView(g);
  v.fit(390, 420, 8);
  const b = v.unitBounds();
  const left = v.origin[0] + b.x0 * v.scale;
  const right = v.origin[0] + b.x1 * v.scale;
  const top = v.origin[1] + b.y0 * v.scale;
  const bottom = v.origin[1] + b.y1 * v.scale;
  assert.ok(left >= 7.99 && right <= 382.01 && top >= 7.99 && bottom <= 412.01);
  assert.ok(Math.abs((left + right) / 2 - 195) < 0.01, 'centred across');
  v.zoomAt(100, 195, 210);
  assert.equal(v.scale, v.fitScale * 2.5);
  v.zoomAt(0.001, 195, 210);
  assert.equal(v.scale, v.fitScale * 0.8);
});

test('back rows are drawn first (painter\'s order) and higher terrain sits higher', () => {
  const g = scenarios['Escort the builder']();
  const v = new IsoView(g);
  const order = v.drawOrder();
  const ys = order.map(([x, y]) => v.plane(x, y)[1]);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
  assert.ok(terrainHeight('water') < terrainHeight('grass'));
  assert.equal(terrainHeight('no-such-type'), 0.5, 'unknown terrain gets a default');
  assert.equal(TERRAIN_HEIGHT.road, terrainHeight('road'));
  // Off-board neighbours (used when aiming at the edge) don't throw.
  assert.equal(v.groundHeight(-1, 3), TERRAIN_HEIGHT.grass);
});

test('pointInPolygon', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInPolygon(5, 5, sq), true);
  assert.equal(pointInPolygon(15, 5, sq), false);
});
