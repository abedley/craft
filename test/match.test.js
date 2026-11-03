import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Teams, move, attack, nextStep, distance, ALL_DIRECTIONS } from '../src/engine/index.js';
import { Match, MatchStatus } from '../src/match.js';
import { planTurn, firstInLine } from '../src/ai/cpu.js';

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
  const g = new Game({ width: 1, height: 6, units: [{ x: 0, y: 0, type: G }, { x: 0, y: 2 }, { x: 0, y: 4, team: C }] });
  g.queueOrder(1, attack('down'));
  const events = g.tick();
  const k = events.find((e) => e.type === 'killed');
  assert.deepEqual([k.unitId, k.team], [2, P]);
  assert.ok(g.getUnit(3)); // the enemy behind was shielded
});

test('orders join the end in the order given; the CPU stages at the start of the turn', () => {
  const g = new Game({ width: 6, height: 6, units: [{ x: 0, y: 0 }, { x: 5, y: 5, team: C }] });
  g.getUnit(2).charges = 0;
  const m = new Match(g);
  m.startTurn(); // the queue starts empty; the CPU's plan goes in first
  assert.deepEqual(g.queue.map((q) => g.getUnit(q.unitId).team), [C]);
  m.playerOrder(1, move(1, 0)); // joins the end
  assert.deepEqual(g.queue.map((q) => q.unitId), [2, 1]);
  // Staging again in the same turn doesn't add a second CPU plan.
  m.startTurn();
  assert.equal(g.queue.filter((q) => q.unitId === 2).length, 1);
});

test('nothing reorders the queue: an order queued before the CPU stages stays ahead of it', () => {
  const g = new Game({ width: 6, height: 6, units: [{ x: 0, y: 0 }, { x: 5, y: 5, team: C }] });
  g.getUnit(2).charges = 0;
  g.queueOrder(1, move(1, 0)); // e.g. a scenario's pre-queued order
  const m = new Match(g);
  m.startTurn();
  assert.deepEqual(g.queue.map((q) => g.getUnit(q.unitId).team), [P, C]);
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
  m.playerOrder(1, move(1, 0));
  m.clearPlayerOrders();
  assert.deepEqual(g.queue.map((q) => q.unitId), [2]);
});

test('CPU wins a same-instant contest because it ordered first', () => {
  // The CPU pikeman is out of reach and walks toward the player's unit; the
  // player steps into the same hex at the same instant.
  const g = new Game({ width: 3, height: 5, units: [{ x: 0, y: 2 }, { x: 1, y: 0, team: C }] });
  const m = new Match(g);
  m.startTurn();
  const [{ order }] = g.queue;
  assert.equal(order.type, 'move');
  const cell = nextStep({ ...g.getUnit(2), order }, g);
  m.playerOrder(1, move(cell.x, cell.y));
  m.endTurn();
  assert.deepEqual([g.getUnit(2).x, g.getUnit(2).y], [cell.x, cell.y]);
  assert.deepEqual([g.getUnit(1).x, g.getUnit(1).y], [0, 2]);
});

test('CPU gunslinger shoots an enemy in line, but not through a teammate', () => {
  // Nearer enemy at (3,1) on the down-right line is screened by a teammate at
  // (1,0); the enemy straight down the column at (0,5) is clear.
  const g = new Game({
    width: 8, height: 8,
    units: [{ x: 0, y: 0, type: G, team: C }, { x: 1, y: 0, team: C }, { x: 3, y: 1 }, { x: 0, y: 5 }],
  });
  const plan = planTurn(g, C);
  assert.deepEqual(plan.find(([id]) => id === 1)[1], attack('down'));
});

test('CPU gunslinger blocked by a teammate moves to the nearest clear firing cell', () => {
  // Teammate at (0,3) screens the column. Clear cells below it, such as
  // (0,4) (4 steps), have a straight shot at the enemy at (0,6). (Speed 6 so
  // that destination is within one turn's walk and shows up as the order.)
  const g = new Game({ width: 8, height: 8, units: [{ x: 0, y: 0, type: G, team: C, speed: 6 }, { x: 0, y: 3, team: C }, { x: 0, y: 6 }] });
  const [, order] = planTurn(g, C).find(([id]) => id === 1);
  assert.deepEqual(order, move(0, 4));
});

test('CPU gunslinger walks to a nearest cell with a clear shot', () => {
  for (const [ex, ey] of [[4, 6], [6, 2], [3, 7], [7, 7]]) {
    // Speed 6 so the chosen firing cell is within one turn's walk.
    const g = new Game({ width: 8, height: 8, units: [{ x: 0, y: 0, type: G, team: C, speed: 6 }, { x: ex, y: ey }] });
    const [[, order]] = planTurn(g, C);
    // Brute force: every cell with a clear straight line to the enemy.
    let best = Infinity;
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        if ((x === ex && y === ey) || (x === 0 && y === 0)) continue;
        const clear = ALL_DIRECTIONS.some((d) => firstInLine(g, x, y, d)?.unit.id === 2);
        if (clear) best = Math.min(best, distance(0, 0, x, y));
      }
    }
    assert.equal(order.type, 'move');
    assert.ok(ALL_DIRECTIONS.some((d) => firstInLine(g, order.x, order.y, d)?.unit.id === 2), `(${order.x},${order.y}) has a shot`);
    assert.equal(distance(0, 0, order.x, order.y), best);
  }
});

test('CPU steps off the line of a shot in flight when it still can', () => {
  // A shot in flight flies first next turn (ahead of the CPU's moves). One
  // that would reach the CPU unit on that flight can't be outrun, so the CPU
  // doesn't try; one that would only reach it on the flight after, can be.
  const g = new Game({ width: 3, height: 10, units: [{ x: 1, y: 0, type: G }, { x: 1, y: 7, team: C }] });
  g.queueOrder(1, attack('down'));
  g.tick(); // shot at (1,4), 3 hexes away: it hits on its next flight
  assert.ok(!planTurn(g, C).some(([, o]) => o.type === 'move' && o.x !== 1));

  const g2 = new Game({ width: 3, height: 14, units: [{ x: 1, y: 0, type: G }, { x: 1, y: 10, team: C }] });
  g2.queueOrder(1, attack('down'));
  g2.tick(); // shot at (1,4), 6 hexes away: reaches (1,8) next flight, (1,10) the one after
  const m = new Match(g2, { vsCpu: true });
  m.startTurn();
  assert.deepEqual(g2.queue.find((e) => e.unitId === 2), { unitId: 2, order: move(2, 10) }); // up-right, off the line
  m.endTurn();
  m.endTurn();
  assert.ok(g2.getUnit(2), 'CPU unit survived');
});

test('match status: won, lost, draw', () => {
  const won = new Match(new Game({ width: 1, height: 5, units: [{ x: 0, y: 0, type: G }, { x: 0, y: 4, team: C }] }));
  won.game.getUnit(2).charges = 0; // (with its charge it would rush in next to us and block the shot)
  won.startTurn(); // the CPU pikeman (out of reach) steps to (0,3)
  won.playerOrder(1, attack('down')); // then our shot reaches it
  won.endTurn();
  assert.equal(won.status, MatchStatus.WON);
  assert.throws(() => won.playerOrder(1, move(0, 1)), /over/);

  // The CPU's shot is staged first, so it lands before ours is ever fired.
  const lost = new Match(new Game({ width: 1, height: 5, units: [{ x: 0, y: 0, type: G }, { x: 0, y: 4, type: G, team: C }] }));
  lost.startTurn();
  lost.playerOrder(1, attack('down'));
  lost.endTurn();
  assert.equal(lost.status, MatchStatus.LOST);

  // Draw: two shots 6 hexes apart are both fired on turn 1 (out of range) and
  // both land on turn 2, when they fly first as carried-over entries.
  const draw = new Match(new Game({ width: 1, height: 7, units: [{ x: 0, y: 0, type: G }, { x: 0, y: 6, type: G, team: C }] }));
  draw.startTurn();
  draw.playerOrder(1, attack('down'));
  draw.endTurn();
  assert.equal(draw.status, MatchStatus.PLAYING);
  draw.endTurn();
  assert.equal(draw.status, MatchStatus.DRAW);

  const sandbox = new Match(new Game({ width: 1, height: 3, units: [{ x: 0, y: 0 }] }));
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
