// Defining unit types in JSON (src/data/units.json format).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  Game, Teams, move, attack, UnitTypes, defineUnitType, registerUnitTypes, DEFAULT_UNIT_TYPE,
} from '../src/engine/index.js';
import { Match } from '../src/match.js';
import { planTurn, firstInLine } from '../src/ai/cpu.js';

const kills = (events) => events.filter((e) => e.type === 'killed').map((e) => e.unitId);

test('the shipped units file loads and matches the registry', () => {
  const json = JSON.parse(readFileSync(new URL('../src/data/units.json', import.meta.url)));
  for (const key of Object.keys(json.units)) assert.equal(UnitTypes[key].name, json.units[key].name);
  assert.equal(DEFAULT_UNIT_TYPE, json.default);
  assert.equal(UnitTypes.pikeman.attack.kind, 'melee');
  assert.equal(UnitTypes.gunslinger.attack.speed, 4);
});

test('validation catches mistakes with clear messages', () => {
  const bad = (raw) => () => defineUnitType('x', raw);
  assert.throws(bad({ speed: 1 }), /"x": "name"/);
  assert.throws(bad({ name: 'X', speed: 0 }), /"speed" must be an integer from 1/);
  assert.throws(bad({ name: 'X', speed: 1, colour: 'red' }), /unknown field "colour"/);
  assert.throws(bad({ name: 'X', speed: 1, shape: 'star' }), /"shape"/);
  assert.throws(bad({ name: 'X', speed: 1, attack: { kind: 'magic', directions: 'all' } }), /"attack.kind"/);
  assert.throws(bad({ name: 'X', speed: 1, attack: { kind: 'melee', directions: 'all' } }), /"attack.reach"/);
  assert.throws(bad({ name: 'X', speed: 1, attack: { kind: 'melee', reach: 1, directions: ['north'] } }), /unknown direction "north"/);
  assert.throws(bad({ name: 'X', speed: 1, attack: { kind: 'melee', reach: 1 } }), /directions" is required/);
  assert.throws(bad({ name: 'X', speed: 1, attack: { kind: 'projectile', speed: 2, range: 0, directions: 'all' } }), /"attack.range"/);
  assert.throws(bad({ name: 'X', speed: 1, attack: { kind: 'projectile', speed: 2, reach: 1, directions: 'all' } }), /unknown field "attack.reach"/);
  assert.throws(() => registerUnitTypes({ default: 'nope', units: {} }), /Default unit type "nope"/);
});

test('a bad file does not change the registry', () => {
  const before = { ...UnitTypes };
  assert.throws(() => registerUnitTypes({ units: { ok: { name: 'Ok', speed: 1 }, broken: { name: 'B' } } }));
  assert.deepEqual(Object.keys(UnitTypes), Object.keys(before));
});

// A few new units, defined only in JSON, exercising each feature.
// Hex lines used: a row (left/right), and the down-right line from (0,0):
// (1,0), (2,1), (3,1), (4,2), (5,2), (6,3).
registerUnitTypes({
  units: {
    halberdier: { name: 'Halberdier', speed: 1, shape: 'square', attack: { kind: 'melee', reach: 3, directions: 'horizontal' } },
    archer: { name: 'Archer', speed: 1, shape: 'triangle', attack: { kind: 'projectile', speed: 2, range: 3, directions: ['down-right', 'up-left'] } },
    scout: { name: 'Scout', speed: 3 },
  },
});

test('new JSON units work in the engine with no code changes', () => {
  // Halberdier: reach 3, left/right only.
  const g = new Game({ width: 5, height: 1, units: [{ x: 0, y: 0, type: 'halberdier' }, { x: 3, y: 0 }, { x: 4, y: 0 }] });
  assert.throws(() => g.queueOrder(1, attack('down-left')), /direction/);
  g.queueOrder(1, attack('right'));
  assert.deepEqual(kills(g.tick()), [2]); // (0,3) is within reach 3; (0,4) is not

  // Scout: speed 3 from the type, and it can't attack.
  const s = new Game({ width: 6, height: 1, units: [{ x: 0, y: 0, type: 'scout' }] });
  assert.equal(s.getUnit(1).speed, 3);
  assert.throws(() => s.queueOrder(1, attack('right')), /Scout units cannot attack/);
  assert.throws(() => s.queueOrder(1, move(4, 0)), /up to 3 hexes/);
  s.queueOrder(1, move(3, 0));
  s.tick();
  assert.equal(s.getUnit(1).x, 3);
});

test('projectile range: an archer arrow stops after 3 hexes', () => {
  const g = new Game({ width: 6, height: 6, units: [{ x: 0, y: 0, type: 'archer' }, { x: 1, y: 3 }] });
  g.queueOrder(1, attack('down-right'));
  let events = g.tick(); // speed 2: (0,1), (1,2)
  assert.deepEqual(kills(events), []);
  events = g.tick(); // (1,3), 3 hexes out, hits unit 2 at t=1/2
  assert.deepEqual(kills(events), [2]);

  const miss = new Game({ width: 6, height: 6, units: [{ x: 0, y: 0, type: 'archer' }, { x: 2, y: 4 }] });
  miss.queueOrder(1, attack('down-right'));
  miss.tick();
  events = miss.tick(); // reaches (1,3), then would be at (2,4): past range, gone
  assert.deepEqual(kills(events), []);
  assert.equal(miss.projectiles.length, 0);
  assert.ok(events.some((e) => e.type === 'projectileExpired'));
});

test('the CPU plays new JSON units from their definitions', () => {
  const C = Teams.CPU;
  // Archer shoots along its allowed line at an enemy within range...
  const g = new Game({ width: 8, height: 8, units: [{ x: 0, y: 0, type: 'archer', team: C }, { x: 1, y: 2 }] });
  assert.deepEqual(planTurn(g, C), [[1, attack('down-right')]]);
  // ...but not one beyond its range; it moves to a hex with an in-range shot instead.
  // (Speed 6 so its chosen firing hex is within one turn's walk and shows up as the order.)
  const far = new Game({ width: 8, height: 8, units: [{ x: 0, y: 0, type: 'archer', team: C, speed: 6 }, { x: 3, y: 6 }] });
  const [[, order]] = planTurn(far, C);
  assert.equal(order.type, 'move');
  const shots = ['down-right', 'up-left'].map((d) => firstInLine(far, order.x, order.y, d, 3));
  assert.ok(shots.some((h) => h?.unit.id === 2), `firing hex ${order.x},${order.y} has an in-range shot`);

  // Halberdier strikes an enemy 3 hexes away in a straight line.
  const h = new Game({ width: 8, height: 8, units: [{ x: 0, y: 0, type: 'halberdier', team: C }, { x: 3, y: 0 }] });
  assert.deepEqual(planTurn(h, C), [[1, attack('right')]]);

  // A unit with no attack just closes in.
  const sc = new Game({ width: 8, height: 8, units: [{ x: 0, y: 0, type: 'scout', team: C }, { x: 7, y: 0 }] });
  assert.deepEqual(planTurn(sc, C), [[1, move(3, 0)]], 'as far as its speed (3) allows');
});

test('a match with JSON-only units runs to the end deterministically', () => {
  const run = () => {
    const g = new Game({
      width: 8, height: 8,
      units: [
        { x: 7, y: 0, type: 'archer' }, { x: 7, y: 3, type: 'halberdier' }, { x: 7, y: 6, type: 'scout' },
        { x: 0, y: 1, type: 'archer', team: Teams.CPU }, { x: 0, y: 4, type: 'halberdier', team: Teams.CPU },
      ],
    });
    const m = new Match(g);
    m.startTurn();
    for (let t = 0; t < 40 && m.status === 'playing'; t++) {
      for (const [id, o] of planTurn(g, Teams.PLAYER)) m.playerOrder(id, o);
      m.endTurn();
    }
    return g.hash();
  };
  assert.equal(run(), run());
});

test('square-grid direction sets give a helpful error', () => {
  assert.throws(
    () => defineUnitType('x', { name: 'X', speed: 1, attack: { kind: 'melee', reach: 1, directions: 'orthogonal' } }),
    /must be all, horizontal or a list of hex directions/,
  );
  // "vertical" (from the flat-topped grid) explains why it's gone.
  assert.throws(
    () => defineUnitType('x', { name: 'X', speed: 1, attack: { kind: 'melee', reach: 1, directions: 'vertical' } }),
    /"vertical" is gone: hexes are pointy-topped/,
  );
  assert.throws(
    () => defineUnitType('x', { name: 'X', speed: 1, attack: { kind: 'melee', reach: 1, directions: ['up'] } }),
    /unknown direction "up"/,
  );
});
