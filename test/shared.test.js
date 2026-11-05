// UI helpers shared by the game and the debug UI (src/app/shared.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movePath, rayCells, moveReach, teleportReach, nearestDirection, previewOf, fmtOrder } from '../src/app/shared.js';
import { Game, Teams, move, attack, quickMove, charge, teleport, build, distance } from '../src/engine/index.js';
import { IsoView } from '../src/app/iso.js';

test('movePath follows the route a move will take', () => {
  const g = new Game({ width: 5, height: 5, terrain: ['.....', '.....', '..~..', '.....', '.....'], units: [{ x: 2, y: 4, speed: 4 }] });
  const path = movePath(g, g.getUnit(1), 2, 1);
  assert.deepEqual(path[0], [2, 4]);
  assert.deepEqual(path[path.length - 1], [2, 1]);
  assert.equal(path.length, 5, 'four steps: the straight line is blocked');
  assert.ok(!path.some(([x, y]) => x === 2 && y === 2), 'goes round the water');
  // The real move ends where the path says.
  g.queueOrder(1, move(2, 1));
  g.tick();
  assert.deepEqual([g.getUnit(1).x, g.getUnit(1).y], [2, 1]);
});

test('rayCells stops at the edge and at the first building', () => {
  const g = new Game({ width: 1, height: 6, units: [{ x: 0, y: 5 }] });
  assert.deepEqual(rayCells(g, 0, 5, 'up'), [[0, 4], [0, 3], [0, 2], [0, 1], [0, 0]]);
  assert.deepEqual(rayCells(g, 0, 5, 'up', 2), [[0, 4], [0, 3]]);
  g.state.buildings.push({ id: 1, x: 0, y: 2, team: Teams.CPU });
  assert.deepEqual(rayCells(g, 0, 5, 'up'), [[0, 4], [0, 3], [0, 2]]);
});

test('moveReach and teleportReach list legal targets', () => {
  const g = new Game({ width: 5, height: 5, units: [{ x: 2, y: 2, type: 'stalker' }, { x: 2, y: 0 }] });
  const u = g.getUnit(1);
  const reach = moveReach(g, u);
  assert.equal(reach.length, 6);
  for (const [x, y] of reach) assert.doesNotThrow(() => g.clone().queueOrder(1, move(x, y)));
  const tp = teleportReach(g, u, 3);
  assert.ok(tp.every(([x, y]) => distance(2, 2, x, y) <= 3 && !(x === 2 && y === 0)));
  for (const [x, y] of tp) assert.doesNotThrow(() => g.clone().queueOrder(1, teleport(x, y)));
});

test('nearestDirection snaps a tap to a direction in the iso view too', () => {
  const g = new Game({ width: 7, height: 7, units: [{ x: 3, y: 3 }] });
  const v = new IsoView(g);
  v.fit(390, 400);
  const u = g.getUnit(1);
  const center = (x, y) => v.center(x, y);
  const all = ['up', 'up-right', 'down-right', 'down', 'down-left', 'up-left'];
  assert.equal(nearestDirection(center, u, 3, 0, all), 'up');
  assert.equal(nearestDirection(center, u, 3, 6, all), 'down');
  assert.equal(nearestDirection(center, u, 5, 2, all), 'up-right');
  assert.equal(nearestDirection(center, u, 1, 4, all), 'down-left');
  assert.equal(nearestDirection(center, u, 3, 0, ['down', 'down-left']), 'down-left');
});

test('previewOf runs the turn on a copy', () => {
  const g = new Game({ width: 1, height: 5, units: [{ x: 0, y: 4, type: 'gunslinger' }, { x: 0, y: 0, team: Teams.CPU }] });
  g.queueOrder(1, attack('up'));
  const before = g.hash();
  const p = previewOf(g);
  assert.equal(g.hash(), before, 'the real game is untouched');
  assert.ok(p.killed.has(2));
  assert.equal(p.projectiles.length, 1);
});

test('fmtOrder', () => {
  assert.equal(fmtOrder(move(1, 2)), 'move(1, 2)');
  assert.equal(fmtOrder(quickMove(1, 2)), 'QUICK move(1, 2)');
  assert.equal(fmtOrder(charge('up')), 'CHARGE up');
  assert.equal(fmtOrder(teleport(3, 4)), 'TELEPORT to 3,4');
  assert.equal(fmtOrder(build()), 'BUILD');
  assert.equal(fmtOrder(attack('down')), 'attack(down)');
});
