// Pikemen (melee, reach 2, all 6 hex directions) on the hex grid.
// Useful straight lines: a column (up/down), and the down-right line from
// (0,0): (1,0), (2,1), (3,1), (4,2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Teams, move, attack, nextStep, strikeCells } from '../src/engine/index.js';
import { Match } from '../src/match.js';
import { planTurn } from '../src/ai/cpu.js';

const C = Teams.CPU;
const kills = (events) => events.filter((e) => e.type === 'killed').map((e) => e.unitId);

test('pikeman strike kills both hexes in a row along a straight hex line', () => {
  const g = new Game({
    width: 5, height: 5,
    units: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
  });
  g.queueOrder(1, attack('down-right'));
  const events = g.tick();
  assert.deepEqual(kills(events), [2, 3]); // reach 2: unit 4, 3 hexes away, survives
  assert.ok(g.getUnit(4));
  const t = events.find((e) => e.type === 'strike');
  assert.deepEqual(t.cells, [[1, 0], [2, 1]]);
  const k = events.find((e) => e.type === 'killed');
  assert.deepEqual([k.time, k.hits[0].cause, k.hits[0].attackerId], ['1', 'melee', 1]);
});

test('strike direction validation: the 6 hex directions only', () => {
  const g = new Game({ width: 3, height: 3, units: [{ x: 1, y: 1 }] });
  assert.throws(() => g.queueOrder(1, attack('sideways')), /direction/);
  assert.throws(() => g.queueOrder(1, attack('left')), /direction/);
  assert.doesNotThrow(() => g.queueOrder(1, attack('up-left')));
});

test('strike lands at the end of the tick: units that step out escape', () => {
  const g = new Game({ width: 3, height: 5, units: [{ x: 1, y: 0 }, { x: 1, y: 1 }] });
  g.queueOrder(1, attack('down')); // strikes (1,1) and (1,2)
  g.queueOrder(2, move(2, 1)); // steps down-right, out of the column, at t=1
  // Moves at t=1 resolve before the strike lands, so unit 2 is already gone.
  assert.deepEqual(kills(g.tick()), []);
});

test('units walking into the strike zone are hit', () => {
  const g = new Game({ width: 3, height: 5, units: [{ x: 1, y: 0 }, { x: 2, y: 2 }] });
  g.queueOrder(1, attack('down'));
  g.queueOrder(2, move(1, 2)); // (2,2) -> (1,2) is one step: down-left of an even column
  assert.deepEqual(kills(g.tick()), [2]);
});

test('friendly fire: the strike kills teammates too, and the pikeman holds still', () => {
  const g = new Game({ width: 1, height: 5, units: [{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 0, y: 4, team: C }] });
  g.queueOrder(1, move(0, 4));
  g.tick(); // unit 1 -> (0,1)
  g.queueOrder(1, attack('down'));
  const events = g.tick();
  assert.deepEqual(kills(events), [2]);
  assert.deepEqual([g.getUnit(1).y, g.getUnit(1).order], [1, null]);
});

test('a pikeman killed earlier in the tick does not strike', () => {
  const g = new Game({ width: 3, height: 4, units: [{ x: 0, y: 0, type: 'gunslinger' }, { x: 0, y: 1 }, { x: 1, y: 1 }] });
  g.queueOrder(1, attack('down')); // kills unit 2 at t=1/4
  g.queueOrder(2, attack('down-right')); // (0,1) down-right is (1,1): would have killed unit 3 at t=1
  assert.deepEqual(kills(g.tick()), [2]);
  assert.ok(g.getUnit(3));
});

test('a pikeman shot at t=1 still strikes (simultaneous)', () => {
  const g = new Game({ width: 3, height: 6, units: [{ x: 0, y: 0, type: 'gunslinger' }, { x: 0, y: 4 }, { x: 1, y: 4 }] });
  g.queueOrder(1, attack('down')); // reaches (0,4) at t=1
  g.queueOrder(2, attack('down-right')); // (0,4) down-right is (1,4)
  assert.deepEqual(kills(g.tick()), [2, 3]);
});

test('two pikemen striking each other both die', () => {
  const g = new Game({ width: 1, height: 4, units: [{ x: 0, y: 0 }, { x: 0, y: 2, team: C }] });
  g.queueOrder(1, attack('down'));
  g.queueOrder(2, attack('up'));
  assert.deepEqual(kills(g.tick()), [1, 2]);
});

test('CPU pikeman strikes at an enemy in reach, picking the direction with the most enemies', () => {
  // From (2,2): 'up' hits (2,1) and (2,0) -> one enemy at (2,0).
  // 'down-right' hits (3,2) and (4,3) -> two enemies.
  const g = new Game({
    width: 6, height: 6,
    units: [{ x: 2, y: 2, team: C }, { x: 2, y: 0 }, { x: 3, y: 2 }, { x: 4, y: 3 }],
  });
  assert.deepEqual(planTurn(g, C), [[1, attack('down-right')]]);
});

test('CPU pikeman never strikes through a teammate', () => {
  const g = new Game({ width: 1, height: 6, units: [{ x: 0, y: 0, team: C }, { x: 0, y: 1, team: C }, { x: 0, y: 2 }] });
  const plan = planTurn(g, C);
  assert.ok(!plan.some(([id, o]) => id === 1 && o.type === 'attack'));
  assert.deepEqual(plan.find(([id]) => id === 2), [2, attack('down')]);
});

test('CPU pikemen never strike a hex where a teammate stands or is about to step', () => {
  // Property check over many deterministic layouts (no randomness: a simple
  // linear congruential sequence with a fixed seed).
  let seed = 12345;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  let strikesChecked = 0;
  for (let round = 0; round < 300; round++) {
    const g = new Game({ width: 6, height: 6 });
    for (let k = 0; k < 8; k++) {
      const x = rand(6);
      const y = rand(6);
      if (g.unitAt(x, y)) continue;
      g.addUnit(x, y, undefined, { team: k % 2 ? C : Teams.PLAYER, type: k % 3 ? 'pikeman' : 'gunslinger' });
    }
    const plan = planTurn(g, C);
    const occupied = new Set(g.units.filter((u) => u.team === C).map((u) => `${u.x},${u.y}`));
    for (const [id, order] of plan) {
      const u = g.getUnit(id);
      if (order.type === 'move') {
        const n = nextStep({ ...u, order }, g);
        occupied.add(`${n.x},${n.y}`);
      }
    }
    for (const [id, order] of plan) {
      const u = g.getUnit(id);
      if (order.type !== 'attack' || u.type !== 'pikeman') continue;
      strikesChecked++;
      for (const [x, y] of strikeCells(u, order.dir, 2)) assert.ok(!occupied.has(`${x},${y}`), `round ${round}: unit ${id} strikes a teammate hex ${x},${y}`);
    }
  }
  assert.ok(strikesChecked > 20, `checked ${strikesChecked} strikes`);
});

test('CPU plan is staged before the player and visible in the queue', () => {
  const g = new Game({ width: 1, height: 5, units: [{ x: 0, y: 0 }, { x: 0, y: 2, team: C }] });
  const m = new Match(g);
  m.startTurn();
  assert.deepEqual(g.queue, [{ unitId: 2, order: attack('up') }]);
  // The player sees the strike coming. In a 1-wide column there's nowhere to
  // step out of it, so they strike back and both pikemen die.
  m.playerOrder(1, attack('down'));
  m.endTurn();
  assert.equal(g.units.length, 0);
});
