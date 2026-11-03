// Terrain: every hex has a type (src/data/terrain.json); units can't walk on water.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  Game, Teams, move, attack, nextStep, distancesTo, distance,
  TerrainTypes, DEFAULT_TERRAIN, defineTerrainType, registerTerrainTypes,
} from '../src/engine/index.js';
import { Match } from '../src/match.js';
import { planTurn } from '../src/ai/cpu.js';

const C = Teams.CPU;
const pos = (g, id) => [g.getUnit(id).x, g.getUnit(id).y];

// 5 x 5 with a river across row 2, bridged by a road at column 4.
const RIVER = [
  '.....',
  '.....',
  '~~~~=',
  '.....',
  '.....',
];

test('the shipped terrain file loads; boards default to it', () => {
  const json = JSON.parse(readFileSync(new URL('../src/data/terrain.json', import.meta.url)));
  for (const key of Object.keys(json.types)) assert.equal(TerrainTypes[key].name, json.types[key].name);
  assert.equal(DEFAULT_TERRAIN, 'grass');
  assert.equal(TerrainTypes.water.walkable, false);
  const g = new Game({ width: 3, height: 2 });
  assert.deepEqual(g.terrain, Array(6).fill('grass'));
});

test('maps are written as one character per hex', () => {
  const g = new Game({ width: 5, height: 5, terrain: RIVER });
  assert.equal(g.terrainAt(0, 2), 'water');
  assert.equal(g.terrainAt(4, 2), 'road');
  assert.equal(g.terrainAt(3, 3), 'grass');
  assert.equal(g.isWalkable(0, 2), false);
  assert.equal(g.isWalkable(4, 2), true);
  assert.throws(() => new Game({ width: 2, height: 1, terrain: ['.'] }), /2 characters/);
  assert.throws(() => new Game({ width: 1, height: 2, terrain: ['.'] }), /2 rows/);
  assert.throws(() => new Game({ width: 1, height: 1, terrain: ['?'] }), /Unknown terrain character "\?"/);
});

test('units cannot be placed on, or ordered onto, water', () => {
  const g = new Game({ width: 5, height: 5, terrain: RIVER, units: [{ x: 0, y: 0 }] });
  assert.throws(() => g.addUnit(1, 2), /can't stand on Water/);
  assert.throws(() => g.queueOrder(1, move(1, 2)), /can't walk on Water/);
  assert.throws(() => g.setTerrain(0, 0, 'water'), /Unit 1 is standing/);
  g.setTerrain(1, 0, 'sand');
  assert.equal(g.terrainAt(1, 0), 'sand');
});

test('units path around water, over the bridge, and never step onto it', () => {
  const g = new Game({ width: 5, height: 5, terrain: RIVER, units: [{ x: 0, y: 0 }] });
  g.queueOrder(1, move(0, 4));
  const path = [pos(g, 1)];
  do {
    g.tick();
    path.push(pos(g, 1));
  } while (g.orderFor(1) && path.length < 20);
  assert.deepEqual(pos(g, 1), [0, 4]);
  for (const [x, y] of path) assert.ok(g.isWalkable(x, y), `stepped on ${g.terrainAt(x, y)} at ${x},${y}`);
  assert.ok(path.some(([x, y]) => x === 4 && y === 2), 'crossed by the bridge');
  // A shortest walking route: same length as the BFS distance.
  assert.equal(path.length - 1, distancesTo(g, 0, 4).get('0,0'));
});

test('with no route the unit stays put; open ground is unchanged (straight hex lines)', () => {
  const sealed = new Game({ width: 5, height: 5, terrain: RIVER.map((r) => r.replace('=', '~')), units: [{ x: 0, y: 0 }] });
  sealed.queueOrder(1, move(0, 4));
  sealed.tick();
  assert.deepEqual(pos(sealed, 1), [0, 0]);

  const open = new Game({ width: 8, height: 8 });
  for (const [ax, ay, bx, by] of [[0, 0, 3, 3], [7, 7, 0, 0], [0, 7, 7, 0]]) {
    const u = { x: ax, y: ay, order: move(bx, by) };
    assert.deepEqual(nextStep(u, open), nextStep(u, null), 'same as the plain straight-line step');
    assert.equal(distancesTo(open, bx, by).get(`${ax},${ay}`), distance(ax, ay, bx, by));
  }
});

test('projectiles and strikes ignore terrain', () => {
  const g = new Game({
    width: 1, height: 6, terrain: ['.', '~', '~', '~', '.', '.'],
    units: [{ x: 0, y: 0, type: 'gunslinger' }, { x: 0, y: 4 }],
  });
  g.queueOrder(1, attack('down'));
  const events = g.tick();
  assert.ok(events.some((e) => e.type === 'killed' && e.unitId === 2), 'shot flew over the water');
});

test('terrain is part of the saved state and the hash', () => {
  const a = new Game({ width: 5, height: 5, terrain: RIVER });
  const b = new Game({ width: 5, height: 5 });
  assert.notEqual(a.hash(), b.hash());
  const copy = Game.fromSnapshot(JSON.parse(JSON.stringify(a.snapshot())));
  assert.equal(copy.hash(), a.hash());
  assert.equal(copy.terrainAt(0, 2), 'water');
});

test('terrain definitions are validated', () => {
  const bad = (raw) => () => defineTerrainType('t', raw);
  assert.throws(bad({ name: 'T', char: 'ab', color: '#000000', walkable: true }), /single character/);
  assert.throws(bad({ name: 'T', char: 't', color: 'blue', walkable: true }), /"color"/);
  assert.throws(bad({ name: 'T', char: 't', color: '#000000' }), /"walkable"/);
  assert.throws(bad({ name: 'T', char: 't', color: '#000000', walkable: true, slow: 2 }), /unknown field "slow"/);
  assert.throws(() => registerTerrainTypes({ types: { mud: { name: 'Mud', char: '~', color: '#333333', walkable: true } } }), /share the character/);
  assert.throws(() => registerTerrainTypes({ default: 'water', types: {} }), /must be walkable/);
});

test('new terrain types can be added in JSON', () => {
  registerTerrainTypes({ types: { lava: { name: 'Lava', char: '^', color: '#7a2a10', walkable: false } } });
  const g = new Game({ width: 3, height: 1, terrain: ['.^.'] });
  assert.equal(g.isWalkable(1, 0), false);
  assert.throws(() => g.addUnit(1, 0), /can't stand on Lava/);
});

test('the CPU walks around water to reach the player', () => {
  const g = new Game({ width: 5, height: 5, terrain: RIVER, units: [{ x: 0, y: 4 }, { x: 0, y: 0, team: C }] });
  const m = new Match(g);
  m.startTurn();
  for (let t = 0; t < 10; t++) {
    for (const u of g.units) assert.ok(g.isWalkable(u.x, u.y));
    m.endTurn();
  }
  const cpu = g.getUnit(2);
  assert.ok(!cpu || cpu.y > 2 || (cpu.x === 4 && cpu.y === 2), 'CPU crossed the river (or died trying)');
});

test('the CPU gunslinger picks a firing hex it can stand on, and shoots across water', () => {
  // Enemy at (2,4); the only hexes in its column above it are water except row 0.
  const g = new Game({
    width: 5, height: 5,
    terrain: ['.....', '..~..', '..~..', '..~..', '.....'],
    units: [{ x: 0, y: 0, type: 'gunslinger', team: C }, { x: 2, y: 4 }],
  });
  const [[, order]] = planTurn(g, C);
  assert.equal(order.type, 'move');
  assert.ok(g.isWalkable(order.x, order.y));
  // From (2,0) it can shoot straight down over the water.
  const g2 = new Game({
    width: 5, height: 5,
    terrain: ['.....', '..~..', '..~..', '..~..', '.....'],
    units: [{ x: 2, y: 0, type: 'gunslinger', team: C }, { x: 2, y: 4 }],
  });
  assert.deepEqual(planTurn(g2, C), [[1, attack('down')]]);
});
