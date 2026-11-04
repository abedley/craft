// The demo scenarios, and the escort-mission objective they use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Teams, move } from '../src/engine/index.js';
import { Match, MatchStatus } from '../src/match.js';
import { planTurn } from '../src/ai/cpu.js';
import { scenarios } from '../src/scenarios.js';

const C = Teams.CPU;

test('every scenario builds a valid board', () => {
  for (const [name, make] of Object.entries(scenarios)) {
    const g = make();
    for (const u of g.units) assert.ok(g.isWalkable(u.x, u.y, u.team), `${name}: unit ${u.id} on walkable ground`);
    assert.equal(g.terrain.length, g.width * g.height, name);
  }
});

test('the new boards are the sizes they say', () => {
  const sizes = Object.fromEntries(['Escort the builder', 'Big battle (12x14)', 'Small skirmish (5x6)']
    .map((n) => [n, `${scenarios[n]().width}x${scenarios[n]().height}`]));
  assert.deepEqual(sizes, { 'Escort the builder': '8x10', 'Big battle (12x14)': '12x14', 'Small skirmish (5x6)': '5x6' });
  const big = scenarios['Big battle (12x14)']();
  assert.equal(big.units.filter((u) => u.team === Teams.PLAYER).length, 10);
  assert.equal(big.units.filter((u) => u.team === C).length, 10);
});

test('fair openings: idle for two turns, none of the player\'s units die', () => {
  for (const name of ['Escort the builder', 'Big battle (12x14)', 'Small skirmish (5x6)']) {
    const g = scenarios[name]();
    const m = new Match(g);
    m.startTurn();
    const deaths = [m.endTurn(), m.endTurn()].flat().filter((e) => e.type === 'killed' && e.team === Teams.PLAYER);
    assert.deepEqual(deaths, [], name);
  }
});

test('AI-vs-AI games on the new boards run without errors and stay deterministic', () => {
  for (const name of ['Escort the builder', 'Big battle (12x14)', 'Small skirmish (5x6)']) {
    const run = () => {
      const g = scenarios[name]();
      const m = new Match(g);
      m.startTurn();
      for (let t = 0; t < 40 && m.status === MatchStatus.PLAYING; t++) {
        for (const [id, o] of planTurn(g, Teams.PLAYER)) m.playerOrder(id, o);
        m.endTurn();
      }
      return g.hash();
    };
    assert.equal(run(), run(), name);
  }
});

// ---- Escort objective -----------------------------------------------------

const escortGame = () => new Game({
  width: 1, height: 6,
  units: [{ x: 0, y: 5, type: 'builder' }, { x: 0, y: 0, team: C }],
  objective: { kind: 'escort', unitId: 1, to: [0, 3] },
});

test('escort: you win when the escorted unit reaches the target hex', () => {
  const g = escortGame();
  g.getUnit(2).charges = 0;
  const m = new Match(g);
  assert.equal(m.status, MatchStatus.PLAYING);
  g.queueOrder(1, move(0, 4));
  g.tick();
  assert.equal(m.status, MatchStatus.PLAYING);
  g.queueOrder(1, move(0, 3));
  g.tick();
  assert.equal(m.status, MatchStatus.WON, 'even with CPU units still alive');
});

test('escort: you lose if the escorted unit dies, even with others alive', () => {
  const g = new Game({
    width: 3, height: 6,
    units: [{ x: 0, y: 5, type: 'builder' }, { x: 2, y: 5 }, { x: 0, y: 3, team: C }],
    objective: { kind: 'escort', unitId: 1, to: [0, 0] },
  });
  g.removeUnit(1);
  assert.equal(new Match(g).status, MatchStatus.LOST);
});

test('escort objective survives a snapshot round-trip', () => {
  const g = escortGame();
  const copy = Game.fromSnapshot(JSON.parse(JSON.stringify(g.snapshot())));
  assert.deepEqual(copy.objective, { kind: 'escort', unitId: 1, to: [0, 3] });
  assert.equal(copy.hash(), g.hash());
});

test('the CPU goes for the escorted unit rather than the nearest one', () => {
  // A CPU gunslinger at (1,0) has two player units in its lines of fire: a
  // pikeman 2 hexes away down-right at (3,1), and the escorted builder 7
  // hexes away down the column. It shoots at the builder.
  const g = new Game({
    width: 5, height: 8,
    units: [{ x: 1, y: 7, type: 'builder' }, { x: 1, y: 0, type: 'gunslinger', team: C }, { x: 3, y: 1 }],
    objective: { kind: 'escort', unitId: 1, to: [1, 0] },
  });
  const [[, order]] = planTurn(g, C);
  assert.deepEqual(order, { type: 'attack', dir: 'down' });
  // Without the escort objective it would take the nearer shot.
  g.state.objective = null;
  assert.deepEqual(planTurn(g, C)[0][1], { type: 'attack', dir: 'down-right' });
});
