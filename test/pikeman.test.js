// Pikemen (melee, reach 2, all 6 hex directions) on the hex grid.
// Useful straight lines: a row (left/right), and the down-right line from
// (0,0): (0,1), (1,2), (1,3), (2,4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Teams, move, attack, nextStep, strikeCells } from '../src/engine/index.js';
import { Match } from '../src/match.js';
import { planTurn } from '../src/ai/cpu.js';

const C = Teams.CPU;
const kills = (events) => events.filter((e) => e.type === 'killed').map((e) => e.unitId);

test('a strike kills both hexes in a row along a straight hex line, in its own queue step', () => {
  const g = new Game({
    width: 5, height: 5,
    units: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }],
  });
  g.queueOrder(1, attack('down-right'));
  const events = g.tick();
  assert.deepEqual(kills(events), [2, 3]); // reach 2: unit 4, 3 hexes away, survives
  assert.ok(g.getUnit(4));
  const t = events.find((e) => e.type === 'strike');
  assert.deepEqual(t.cells, [[0, 1], [1, 2]]);
  const k = events.find((e) => e.type === 'killed');
  assert.deepEqual([k.step, k.hits[0].cause, k.hits[0].attackerId], [1, 'melee', 1]);
});

test('strike direction validation: the 6 hex directions only', () => {
  const g = new Game({ width: 3, height: 3, units: [{ x: 1, y: 1 }] });
  assert.throws(() => g.queueOrder(1, attack('sideways')), /direction/);
  assert.throws(() => g.queueOrder(1, attack('down')), /direction/);
  assert.doesNotThrow(() => g.queueOrder(1, attack('up-left')));
});

test('queue order decides a strike vs a unit stepping out of reach', () => {
  const setup = () => new Game({ width: 5, height: 3, units: [{ x: 0, y: 1 }, { x: 1, y: 1 }] });

  const strikeFirst = setup();
  strikeFirst.queueOrder(1, attack('right')); // hexes (1,1) and (2,1)
  strikeFirst.queueOrder(2, move(1, 2)); // out of the row
  assert.deepEqual(kills(strikeFirst.tick()), [2]);

  const stepFirst = setup();
  stepFirst.queueOrder(2, move(1, 2));
  stepFirst.queueOrder(1, attack('right'));
  assert.deepEqual(kills(stepFirst.tick()), []);
});

test('a strike only hits who is there when it runs: walking in afterwards is safe', () => {
  const g = new Game({ width: 5, height: 3, units: [{ x: 0, y: 1 }, { x: 2, y: 2 }] });
  g.queueOrder(1, attack('right'));
  g.queueOrder(2, move(2, 1)); // into the struck hex, after the strike
  assert.deepEqual(kills(g.tick()), []);
  assert.deepEqual([g.getUnit(2).x, g.getUnit(2).y], [2, 1]);
});

test('friendly fire: the strike kills teammates too, and the pikeman holds still', () => {
  const g = new Game({ width: 5, height: 1, units: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0, team: C }] });
  g.queueOrder(1, move(1, 0));
  g.tick(); // unit 1 -> (0,1)
  g.queueOrder(1, attack('right'));
  const events = g.tick();
  assert.deepEqual(kills(events), [2]);
  assert.deepEqual([g.getUnit(1).x, g.orderFor(1)], [1, null]);
});

test('a pikeman killed earlier in the queue never strikes', () => {
  const g = new Game({ width: 4, height: 3, units: [{ x: 0, y: 0, type: 'gunslinger' }, { x: 1, y: 0 }, { x: 1, y: 1 }] });
  g.queueOrder(1, attack('right')); // kills unit 2
  g.queueOrder(2, attack('down-right')); // would have killed unit 3
  assert.deepEqual(kills(g.tick()), [2]);
  assert.ok(g.getUnit(3));
});

test('two pikemen facing each other: the first in the queue wins', () => {
  const g = new Game({ width: 4, height: 1, units: [{ x: 0, y: 0 }, { x: 2, y: 0, team: C }] });
  g.queueOrder(2, attack('left'));
  g.queueOrder(1, attack('right'));
  assert.deepEqual(kills(g.tick()), [1]);
  assert.ok(g.getUnit(2));
});

test('CPU pikeman strikes at an enemy in reach, picking the direction with the most enemies', () => {
  // From (2,2): 'left' hits (1,2) and (0,2) -> one enemy at (0,2).
  // 'down-right' hits (2,3) and (3,4) -> two enemies.
  const g = new Game({
    width: 6, height: 6,
    units: [{ x: 2, y: 2, team: C }, { x: 0, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 4 }],
  });
  assert.deepEqual(planTurn(g, C), [[1, attack('down-right')]]);
});

test('CPU pikeman never strikes through a teammate', () => {
  const g = new Game({ width: 6, height: 1, units: [{ x: 0, y: 0, team: C }, { x: 1, y: 0, team: C }, { x: 2, y: 0 }] });
  const plan = planTurn(g, C);
  assert.ok(!plan.some(([id, o]) => id === 1 && o.type === 'attack'));
  assert.deepEqual(plan.find(([id]) => id === 2), [2, attack('right')]);
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

test('CPU plan is staged before the player, visible, and runs first', () => {
  const g = new Game({ width: 5, height: 1, units: [{ x: 0, y: 0 }, { x: 2, y: 0, team: C }] });
  const m = new Match(g);
  m.startTurn();
  assert.deepEqual(g.queue, [{ unitId: 2, order: attack('left') }]);
  // A counter-strike queued after it never happens: the CPU's strike runs first.
  m.playerOrder(1, attack('right'));
  m.endTurn();
  assert.deepEqual(g.units.map((u) => u.id), [2]);
});
