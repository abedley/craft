// CPU opponent.
//
// planTurn() looks at the board as it stands at the start of a turn, before
// the player has given any orders, and returns the orders for every unit on
// its team. It is deterministic: no randomness, units are considered in id
// order, and every tie is broken by a fixed rule, so the same board always
// produces the same plan (replays and undo stay exact).
//
// Behaviour comes from each unit's type definition (src/data/units.json), so
// new units defined in JSON get sensible play without code changes. Per unit,
// in priority order:
//   1. Dodge: if a projectile in flight (anyone's: friendly fire is on) will
//      hit this unit on its flight after next, with nothing in between, step
//      sideways off its line. (One that hits on its next flight can't be
//      outrun: it's ahead of the CPU's moves in the queue.)
//   2. Attack, by attack kind:
//      - projectile: fire if the first unit along an allowed direction, within
//        range, is an enemy (never when a teammate is first in line); nearest
//        enemy first. Not when an enemy is next to it, if its attack is
//        blockedByAdjacentEnemy: the shot would fail.
//      - melee: strike in the allowed direction that catches the most enemies
//        within reach, as the board stands now, and never when a teammate
//        would be in the strike: either standing there or, for a teammate
//        already planned this turn, stepping in.
//   3. Charge (melee units with charges left): if a straight-line charge in
//      some direction would end with a strike on enemies (and no teammates),
//      charge in the direction that hits the most.
//   4. Move: projectile units head for the nearest free cell with a clear
//      shot (allowed direction, in range, nothing in between, and not next to
//      an enemy if that would block the shot) at some enemy; everyone else
//      heads for the nearest enemy. "Nearest" is walking distance around
//      terrain units can't cross (e.g. water); firing cells must be walkable
//      and reachable, but shots fly over any terrain. A move is one turn's
//      walk, so the order is for the furthest hex toward that destination the
//      unit can reach this turn (it re-plans next turn).
//
// Distances are hex steps; lines are straight hex lines (see engine/hex.js).

import { move, attack, charge } from '../engine/orders.js';
import { nextStep, strikeCells, distancesTo, chargePlan, walkToward } from '../engine/game.js';
import { getUnitType, AttackKind } from '../engine/unitTypes.js';
import { step, distance, OPPOSITE, neighbors } from '../engine/hex.js';

// Fixed tie-break order for directions.
const DIR_PRIORITY = ['up', 'down', 'up-right', 'down-right', 'down-left', 'up-left'];
const hexDist = (a, b) => distance(a.x, a.y, b.x, b.y);
const inPriorityOrder = (dirs) => DIR_PRIORITY.filter((d) => dirs.includes(d));

/**
 * @param {import('../engine/game.js').Game} game
 * @param {string} team the team to plan for
 * @returns {Array<[number, object]>} [unitId, order] pairs, in unit id order
 */
export function planTurn(game, team) {
  const plan = [];
  const mine = game.units.filter((u) => u.team === team);
  const enemies = game.units.filter((u) => u.team !== team);
  if (enemies.length === 0) return plan;

  // Cells this team's units will occupy this turn (planned so far).
  const teamCells = new Set(mine.map((m) => `${m.x},${m.y}`));
  const planMove = (u, order) => {
    const next = nextStep({ ...u, order }, game);
    teamCells.add(`${next.x},${next.y}`);
  };

  for (const u of mine) {
    const def = getUnitType(u.type);
    const atk = def.attack;

    const dodge = dodgeCell(game, u);
    if (dodge) {
      plan.push([u.id, move(dodge[0], dodge[1])]);
      planMove(u, move(dodge[0], dodge[1]));
      continue;
    }

    const dir = atk && (atk.kind === AttackKind.MELEE
      ? bestStrike(game, u, atk, teamCells)
      : bestShot(game, u, atk));
    if (dir) {
      plan.push([u.id, attack(dir)]);
      continue;
    }

    // Walking distance from u to every hex it can reach (terrain-aware).
    const walk = distancesTo(game, u.x, u.y);
    const target = nearest(u, enemies, walk);

    // Charge: no attack from here, but a straight-line charge would end in a
    // strike on enemies (and none of our own): charge in the best direction.
    if (def.charge && u.charges > 0 && atk?.kind === AttackKind.MELEE) {
      const dir = bestCharge(game, u, atk, teamCells);
      if (dir) {
        plan.push([u.id, charge(dir)]);
        const end = chargePlan(game, u, dir).end;
        teamCells.add(`${end.x},${end.y}`);
        continue;
      }
    }

    const dest = (atk?.kind === AttackKind.PROJECTILE && firingPosition(game, u, atk, enemies, walk))
      || (target && [target.x, target.y]);
    if (dest) {
      // Moves are one turn's walk: head as far toward dest as speed allows.
      const [x, y] = walkToward(game, u, dest[0], dest[1]);
      if (x !== u.x || y !== u.y) {
        plan.push([u.id, move(x, y)]);
        planMove(u, move(x, y));
      }
    }
  }
  return plan;
}

/** First unit along a straight line from (x, y), not counting (x, y). */
export function firstInLine(game, x, y, dir, maxDist = Infinity) {
  let [cx, cy] = step(x, y, dir);
  for (let d = 1; game.inBounds(cx, cy) && d <= maxDist; d++, [cx, cy] = step(cx, cy, dir)) {
    const hit = game.unitAt(cx, cy);
    if (hit) return { unit: hit, dist: d };
  }
  return null;
}

function bestShot(game, u, atk) {
  // The shot would fail with an enemy next to us (see unitTypes.js).
  if (atk.blockedByAdjacentEnemy && game.adjacentEnemy(u)) return null;
  let best = null;
  for (const dir of inPriorityOrder(atk.directions)) {
    const hit = firstInLine(game, u.x, u.y, dir, atk.range ?? Infinity);
    if (!hit || hit.unit.team === u.team) continue;
    if (!best || hit.dist < best.dist) best = { dir, dist: hit.dist };
  }
  return best?.dir ?? null;
}

function bestStrike(game, u, atk, teamCells) {
  let best = null;
  for (const dir of inPriorityOrder(atk.directions)) {
    const cells = strikeCells(u, dir, atk.reach);
    if (cells.some(([x, y]) => teamCells.has(`${x},${y}`))) continue;
    const enemies = cells.filter(([x, y]) => {
      const occ = game.unitAt(x, y);
      return occ && occ.team !== u.team;
    }).length;
    if (enemies > 0 && (!best || enemies > best.enemies)) best = { dir, enemies };
  }
  return best?.dir ?? null;
}

/** Nearest enemy by walking distance; null if none can be reached. */
/** Direction whose charge-then-strike hits the most enemies and no teammates. */
function bestCharge(game, u, atk, teamCells) {
  let best = null;
  for (const dir of inPriorityOrder(atk.directions)) {
    const plan = chargePlan(game, u, dir);
    if (plan.path.some(([x, y], i) => i > 0 && teamCells.has(`${x},${y}`))) continue;
    if (plan.strike.some(([x, y]) => teamCells.has(`${x},${y}`))) continue;
    const enemies = plan.strike.filter(([x, y]) => {
      const occ = game.unitAt(x, y);
      return occ && occ.team !== u.team;
    }).length;
    if (enemies > 0 && (!best || enemies > best.enemies)) best = { dir, enemies };
  }
  return best?.dir ?? null;
}

function nearest(u, others, walk) {
  let best = null;
  for (const o of others) {
    const d = walk.get(`${o.x},${o.y}`);
    if (d === undefined) continue;
    if (!best || d < best.d) best = { o, d };
  }
  return best?.o ?? null;
}

/**
 * Nearest free hex (by walking distance from u) that u can stand on and
 * reach, from which some enemy is the first unit along an allowed firing
 * direction, within range. Shots fly over any terrain. Ties: nearer enemy,
 * then lower y, then lower x.
 */
function firingPosition(game, u, atk, enemies, walk) {
  let best = null;
  for (const e of enemies) {
    for (const firing of inPriorityOrder(atk.directions)) {
      // A shooter firing `firing` at e stands on the opposite side of e.
      // Walk outward from e; each free cell passed has a clear line back to
      // it. Stop at the first unit (it would block the shot), except u
      // itself, which will have moved away.
      const back = OPPOSITE[firing];
      let [x, y] = step(e.x, e.y, back);
      for (let d = 1; game.inBounds(x, y) && d <= (atk.range ?? Infinity); d++, [x, y] = step(x, y, back)) {
        const occ = game.unitAt(x, y);
        if (occ && occ.id !== u.id) break;
        if (occ) continue; // u's own cell: if a shot existed bestShot would have fired
        // Shooting from next to an enemy would fail.
        if (atk.blockedByAdjacentEnemy && neighbors(x, y).some(([, nx, ny]) => {
          const n = game.unitAt(nx, ny);
          return n && n.team !== u.team;
        })) continue;
        const d = walk.get(`${x},${y}`); // undefined: can't stand there or can't get there
        if (d === undefined) continue;
        const cand = { x, y, d, de: hexDist(u, e) };
        if (!best || cand.d < best.d || (cand.d === best.d && (cand.de < best.de
          || (cand.de === best.de && (y < best.y || (y === best.y && x < best.x)))))) {
          best = cand;
        }
      }
    }
  }
  return best && [best.x, best.y];
}

/**
 * If a projectile in flight will hit this unit on its flight AFTER next, step
 * off its line now. (Projectiles in flight are carried over to the front of
 * next turn's queue, ahead of the CPU's moves, so one that reaches the unit
 * on its very next flight can't be outrun; the CPU has no quick moves.)
 */
function dodgeCell(game, u) {
  for (const p of game.projectiles) {
    // How many hexes until p reaches u's hex, if u is on p's path at all?
    let k = 0;
    let [x, y] = [p.x, p.y];
    while (game.inBounds(x, y) && !(x === u.x && y === u.y) && k <= 2 * p.speed) {
      [x, y] = step(x, y, p.dir);
      k += 1;
    }
    if (k === 0 || x !== u.x || y !== u.y) continue;
    if (k <= p.speed) continue; // it hits before we can move: nothing to do
    if (k > 2 * p.speed) continue; // not urgent yet
    if (p.range !== null && p.traveled + k > p.range) continue; // falls short
    // Something else in between will take the hit.
    const first = firstInLine(game, p.x, p.y, p.dir);
    if (!first || first.unit.id !== u.id) continue;
    // Step to a free neighbour off the projectile's line.
    for (const side of DIR_PRIORITY) {
      if (side === p.dir || side === OPPOSITE[p.dir]) continue;
      const [nx, ny] = step(u.x, u.y, side);
      if (game.isWalkable(nx, ny) && !game.unitAt(nx, ny)) return [nx, ny];
    }
  }
  return null;
}
