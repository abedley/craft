import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Teams, move, shoot } from '../src/engine/index.js';
import { Match, MatchStatus } from '../src/match.js';
import { planTurn } from '../src/ai/cpu.js';

const P = Teams.PLAYER;
const C = Teams.CPU;
const G = 'gunslinger';
const unitsOf = (g, team) => g.units.filter((u) => u.team === team).map((u) => u.id);

test('units default to the player team; unknown teams are rejected', () => {
  const g = new Game({ width: 4, height: 4, units: [{ x: 0, y: 0 }, { x: 1, y: 1, team: C }] });
  assert.equal(g.getUnit(1).team, P);
  assert.equal(g.getUnit(2).team, C);
  assert.throws(() => g.addUnit(2, 2, undefined, { team: 'aliens' }), /Unknown team/);
});

test('friendly fire: a projectile kills a teammate in its line', () => {
  const g = new Game({ width: 6, height: 1, units: [{ x: 0, y: 0, type: G }, { x: 2, y: 0 }, { x: 4, y: 0, team: C }] });
  g.queueOrder(1, shoot('right'));
  const events = g.tick();
  const k = events.find((e) => e.type === 'killed');
  assert.deepEqual([k.unitId, k.team], [2, P]);
  assert.ok(g.getUnit(3)); // the enemy behind was shielded
});

test('CPU stages its orders first, before any player order', () => {
  const g = new Game({ width: 6, height: 6, units: [{ x: 0, y: 0 }, { x: 5, y: 5, team: C }] });
  g.queueOrder(1, move(1, 0)); // e.g. scenario setup queued earlier
  const m = new Match(g);
  m.startTurn();
  assert.deepEqual(g.queue.map((q) => g.getUnit(q.unitId).team), [C, P]);
  m.playerOrder(1, move(2, 0));
  assert.equal(g.queue[0].unitId, 2);
  // Staging again in the same turn doesn't add a second CPU plan.
  m.startTurn();
  assert.equal(g.queue.filter((q) => q.unitId === 2).length, 1);
});

test('player cannot order CPU units', () => {
  const g = new Game({ width: 4, height: 4, units: [{ x: 0, y: 0 }, { x: 3, y: 3, team: C }] });
  const m = new Match(g);
  assert.throws(() => m.playerOrder(2, move(2, 3)), /belongs to the CPU/);
});

test('clearing player orders keeps the CPU plan', () => {
  const g = new Game({ width: 6, height: 6, units: [{ x: 0, y: 0 }, { x: 5, y: 5, team: C }] });
  const m = new Match(g);
  m.startTurn();
  m.playerOrder(1, move(3, 0));
  m.clearPlayerOrders();
  assert.deepEqual(g.queue.map((q) => q.unitId), [2]);
});

test('CPU wins a same-instant contest because it ordered first', () => {
  // Both units are one step from (1,1) and step into it at the same instant.
  const g = new Game({ width: 3, height: 3, units: [{ x: 0, y: 1 }, { x: 2, y: 1, team: C }] });
  const m = new Match(g);
  m.startTurn(); // CPU basic heads for the player: first step is (1,1)
  m.playerOrder(1, move(1, 1));
  m.endTurn();
  assert.deepEqual([g.getUnit(2).x, g.getUnit(2).y], [1, 1]);
  assert.deepEqual([g.getUnit(1).x, g.getUnit(1).y], [0, 1]);
});

test('CPU gunslinger shoots an enemy in line, but not through a teammate', () => {
  const g = new Game({
    width: 8, height: 8,
    units: [{ x: 0, y: 0, type: G, team: C }, { x: 5, y: 0 }, { x: 0, y: 2, team: C }, { x: 0, y: 6 }],
  });
  const plan = planTurn(g, C);
  assert.deepEqual(plan.find(([id]) => id === 1)[1], shoot('right'));
});

test('CPU gunslinger blocked by a teammate moves to a clear firing cell', () => {
  // Teammate at (3,0) blocks the row. Cells with a clear line to the enemy
  // at (6,0) include (4,0) (4 steps away) and (6,1) (7 steps): nearest wins.
  const g = new Game({ width: 8, height: 8, units: [{ x: 0, y: 0, type: G, team: C }, { x: 3, y: 0, team: C }, { x: 6, y: 0 }] });
  const [, order] = planTurn(g, C).find(([id]) => id === 1);
  assert.deepEqual(order, move(4, 0));
});

test('CPU gunslinger walks to the nearest cell with a clear shot', () => {
  const g = new Game({ width: 8, height: 8, units: [{ x: 0, y: 0, type: G, team: C }, { x: 2, y: 6 }] });
  const [[, order]] = planTurn(g, C);
  assert.deepEqual(order, move(2, 0)); // 2 steps to share a column vs 6 to share a row
});

test('CPU gunslinger does not pick a firing cell blocked by another unit', () => {
  // Enemy at (2,6); (2,0) is nearest but a teammate at (2,3) blocks that column.
  const g = new Game({ width: 8, height: 8, units: [{ x: 0, y: 0, type: G, team: C }, { x: 2, y: 3, team: C }, { x: 2, y: 6 }] });
  const [, order] = planTurn(g, C).find(([id]) => id === 1);
  assert.deepEqual(order, move(2, 4)); // first clear cell in the column, 6 steps; row cell (0,6) is also 6 -> lower y wins
});

test('CPU dodges an incoming projectile when it has time', () => {
  const g = new Game({ width: 10, height: 3, units: [{ x: 0, y: 1, type: G }, { x: 7, y: 1, team: C }] });
  g.queueOrder(1, shoot('right'));
  g.tick(); // projectile at x=4, 3 cells away: it arrives at t=3/4, before the
  // unit could leave at t=1, so a dodge can't work and isn't tried.
  assert.ok(!planTurn(g, C).some(([, o]) => o.type === 'move' && o.y !== 1));

  const g2 = new Game({ width: 14, height: 3, units: [{ x: 0, y: 1, type: G }, { x: 9, y: 1, team: C }] });
  g2.queueOrder(1, shoot('right'));
  g2.tick(); // projectile at x=4, 5 away: reaches x=9 at t=5/4; unit leaves at t=1
  const m = new Match(g2, { vsCpu: true });
  m.startTurn();
  assert.deepEqual(g2.queue[0], { unitId: 2, order: move(9, 0) });
  m.endTurn();
  m.endTurn();
  assert.ok(g2.getUnit(2), 'CPU unit survived');
});

test('match status: won, lost, draw', () => {
  const won = new Match(new Game({ width: 5, height: 1, units: [{ x: 0, y: 0, type: G }, { x: 4, y: 0, team: C }] }));
  won.startTurn();
  won.playerOrder(1, shoot('right'));
  // The CPU's basic unit walks toward us into our shot.
  won.endTurn();
  assert.equal(won.status, MatchStatus.WON);
  assert.throws(() => won.playerOrder(1, move(1, 0)), /over/);

  const draw = new Match(new Game({ width: 5, height: 1, units: [{ x: 0, y: 0, type: G }, { x: 4, y: 0, type: G, team: C }] }));
  draw.startTurn(); // CPU shoots left
  draw.playerOrder(1, shoot('right'));
  draw.endTurn();
  draw.endTurn();
  assert.equal(draw.status, MatchStatus.DRAW);

  const lost = new Match(new Game({ width: 5, height: 1, units: [{ x: 0, y: 0 }, { x: 4, y: 0, type: G, team: C }] }));
  lost.startTurn();
  lost.endTurn();
  assert.equal(lost.status, MatchStatus.LOST);

  const sandbox = new Match(new Game({ width: 3, height: 1, units: [{ x: 0, y: 0 }] }));
  assert.equal(sandbox.status, MatchStatus.PLAYING);
});

test('a full AI-vs-AI match replays identically', () => {
  const run = () => {
    const g = new Game({
      width: 8, height: 8,
      units: [
        { x: 0, y: 0, type: G }, { x: 0, y: 7, type: G }, { x: 1, y: 3 },
        { x: 7, y: 7, type: G, team: C }, { x: 7, y: 0, type: G, team: C }, { x: 6, y: 4, team: C },
      ],
    });
    const m = new Match(g);
    m.startTurn();
    for (let t = 0; t < 30 && m.status === MatchStatus.PLAYING; t++) {
      // Let the same AI drive the player too, queued after the CPU.
      for (const [id, o] of planTurn(g, P)) m.playerOrder(id, o);
      m.endTurn();
    }
    return [g.hash(), m.status, g.tickCount];
  };
  const a = run();
  assert.deepEqual(run(), a);
});
