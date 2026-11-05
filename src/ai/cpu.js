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
//   Builders: keep channelling once started; otherwise build on their own
//      hex when no enemy is within 2, step away when one is, and move to a
//      fresh hex when theirs is already built on.
//   Stalkers (units with a teleport): if an enemy is within 2, teleport to
//      the free hex in range furthest from the enemy (leaving a mine where it
//      stood), or, at its mine limit (it can't teleport then), walk away;
//      otherwise close in until about the teleport distance away.
//   Escort missions: if the player is escorting a unit, the CPU heads for
//   that unit (and firing positions on it) rather than the nearest enemy.
//   Shooters don't plan a shot while one of theirs will still be in flight
//   when their turn comes (maxInFlight).
//   4. Move: projectile units head for the nearest free cell with a clear
//      shot (allowed direction, in range, nothing in between, and not next to
//      an enemy if that would block the shot) at some enemy; everyone else
//      heads for the nearest enemy. "Nearest" is walking distance around
//      terrain units can't cross (e.g. water); firing cells must be walkable
//      and reachable, but shots fly over any terrain. A move is one turn's
//      walk, so the order is for the furthest hex toward that destination the
//      unit can reach this turn (it re-plans next turn). The CPU never walks,
//      charges or dodges onto a mine.
//
// Distances are hex steps; lines are straight hex lines (see engine/hex.js).

import { move, attack, charge, teleport, build } from '../engine/orders.js';
import { nextStep, strikeCells, distancesTo, chargePlan, walkToward } from '../engine/game.js';
import { getUnitType, AttackKind } from '../engine/unitTypes.js';
import { step, distance, OPPOSITE, neighbors } from '../engine/hex.js';

// Fixed tie-break order for directions.
const DIR_PRIORITY = ['up-left', 'up-right', 'right', 'left', 'down-right', 'down-left'];
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
  // Escort mission against us: the escorted unit is the priority target.
  const obj = game.objective;
  const vip = obj?.kind === 'escort' ? enemies.find((e) => e.id === obj.unitId) ?? null : null;
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

    // Channelling (e.g. building): leave it be; its order carries itself over.
    if (u.channel) continue;

    const dodge = dodgeCell(game, u);
    if (dodge) {
      plan.push([u.id, move(dodge[0], dodge[1])]);
      planMove(u, move(dodge[0], dodge[1]));
      continue;
    }

    const dir = atk && (atk.kind === AttackKind.MELEE
      ? bestStrike(game, u, atk, teamCells)
      : bestShot(game, u, atk, teamCells));
    if (dir) {
      plan.push([u.id, attack(dir)]);
      continue;
    }

    // Walking distance from u to every hex it can reach (terrain-aware).
    const walk = distancesTo(game, u.x, u.y, u.team);
    const target = nearest(u, enemies, walk);

    // Builders: build where they stand when no enemy is close; step away
    // from enemies that get within 2; move on from a hex that's built on.
    if (def.build) {
      const d = target ? walk.get(`${target.x},${target.y}`) : Infinity;
      if (d <= 2) {
        const away = walkAway(game, u, enemies);
        if (away) {
          plan.push([u.id, move(away[0], away[1])]);
          planMove(u, move(away[0], away[1]));
        }
      } else if (!game.buildingAt(u.x, u.y)) {
        plan.push([u.id, build()]);
      } else {
        const spot = freshHex(game, u, enemies);
        if (spot) {
          plan.push([u.id, move(spot[0], spot[1])]);
          planMove(u, move(spot[0], spot[1]));
        }
      }
      continue;
    }

    // Stalker-style units: teleport away when an enemy gets close (leaving
    // a mine in its path), otherwise hover about the teleport distance away.
    if (def.teleport && u.teleports !== 0) {
      const d = target ? walk.get(`${target.x},${target.y}`) : Infinity;
      const tp = def.teleport;
      const canTeleport = !(tp.leavesMine && tp.maxMines !== null && game.minesOf(u.id).length >= tp.maxMines);
      if (d <= 2 && !canTeleport) {
        // At its mine limit: it can't teleport, so walk away instead.
        const away = walkAway(game, u, enemies);
        if (away) {
          plan.push([u.id, move(away[0], away[1])]);
          planMove(u, move(away[0], away[1]));
        }
        continue;
      }
      if (d <= 2) {
        const spot = escapeHex(game, u, tp.distance, enemies);
        if (spot) {
          plan.push([u.id, teleport(spot[0], spot[1])]);
          teamCells.add(`${spot[0]},${spot[1]}`);
          continue;
        }
      }
      if (d <= def.teleport.distance) continue; // close enough: wait for them
    }

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

    // Head for the escorted unit if there is one we can reach; otherwise the nearest enemy.
    const goal = vip && walk.has(`${vip.x},${vip.y}`) ? vip : target;
    const dest = (atk?.kind === AttackKind.PROJECTILE
      && ((vip && firingPosition(game, u, atk, [vip], walk)) || firingPosition(game, u, atk, enemies, walk)))
      || (goal && [goal.x, goal.y]);
    if (dest) {
      // Moves are one turn's walk: head as far toward dest as speed allows,
      // without walking onto a mine.
      const [x, y] = safeStep(game, u, dest[0], dest[1]);
      if (x !== u.x || y !== u.y) {
        plan.push([u.id, move(x, y)]);
        planMove(u, move(x, y));
      }
    }
  }
  return plan;
}

/**
 * First unit a shot from (x, y) along `dir` would hit, not counting (x, y):
 * null if a building (which stops shots) or the board edge comes first.
 */
export function firstInLine(game, x, y, dir, maxDist = Infinity) {
  let [cx, cy] = step(x, y, dir);
  for (let d = 1; game.inBounds(cx, cy) && d <= maxDist; d++, [cx, cy] = step(cx, cy, dir)) {
    if (game.buildingAt(cx, cy)) return null; // buildings stop shots (and shield units on them)
    const hit = game.unitAt(cx, cy);
    if (hit) return { unit: hit, dist: d };
  }
  return null;
}

function bestShot(game, u, atk, teamCells = new Set()) {
  // The shot would fail with an enemy next to us (see unitTypes.js).
  if (atk.blockedByAdjacentEnemy && game.adjacentEnemy(u)) return null;
  // ...or with too many of our shots still in flight when our entry comes up.
  // Our carried-over shots fly first (ahead of the CPU's new orders); count
  // the ones that will still be flying after that.
  if (atk.maxInFlight !== null) {
    const stillFlying = game.projectilesOf(u.id).filter((p) => survivesNextFlight(game, p)).length;
    if (stillFlying >= atk.maxInFlight) return null;
  }
  // An escorted enemy unit (escort mission) is shot first, then the nearest.
  const vipId = game.objective?.kind === 'escort' ? game.objective.unitId : null;
  let best = null;
  for (const dir of inPriorityOrder(atk.directions)) {
    const hit = firstInLine(game, u.x, u.y, dir, atk.range ?? Infinity);
    if (!hit || hit.unit.team === u.team) continue;
    // Don't fire through a hex a teammate is moving into this turn (its move
    // is earlier in the queue, so it would be standing there).
    let [cx, cy] = [u.x, u.y];
    let friendly = false;
    for (let d = 1; d < hit.dist; d++) {
      [cx, cy] = step(cx, cy, dir);
      if (teamCells.has(`${cx},${cy}`)) friendly = true;
    }
    if (friendly) continue;
    const vip = hit.unit.id === vipId;
    if (!best || (vip && !best.vip) || (vip === best.vip && hit.dist < best.dist)) best = { dir, dist: hit.dist, vip };
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
/** The hexes a move to (x, y) would pass through (engine route, units ignored). */
function routeTo(game, u, x, y) {
  const cells = [];
  let cur = { x: u.x, y: u.y, team: u.team, order: move(x, y) };
  for (let k = 0; k < u.speed; k++) {
    const next = nextStep(cur, game);
    if (next.x === cur.x && next.y === cur.y) break;
    cells.push([next.x, next.y]);
    cur = { ...cur, x: next.x, y: next.y };
  }
  return cells;
}

/**
 * One turn's move toward (tx, ty) that doesn't walk onto or through a mine:
 * the plain walkToward hex if its route is clear, otherwise the reachable
 * hex with a mine-free route that's closest (walking) to the target, if it
 * gets any closer than staying put.
 */
function safeStep(game, u, tx, ty) {
  const [x, y] = walkToward(game, u, tx, ty);
  const mined = (cells) => cells.some(([cx, cy]) => game.mineAt(cx, cy));
  if (!mined(routeTo(game, u, x, y))) return [x, y];
  const toTarget = distancesTo(game, tx, ty, u.team);
  let best = null;
  for (const [k, d] of distancesTo(game, u.x, u.y, u.team)) {
    if (d === 0 || d > u.speed) continue;
    const [cx, cy] = k.split(',').map(Number);
    if (game.unitAt(cx, cy) || mined(routeTo(game, u, cx, cy))) continue;
    const dt = toTarget.get(k) ?? Infinity;
    if (!best || dt < best.d || (dt === best.d && (cy < best.y || (cy === best.y && cx < best.x)))) best = { x: cx, y: cy, d: dt };
  }
  const stay = toTarget.get(`${u.x},${u.y}`) ?? Infinity;
  return best && best.d < stay ? [best.x, best.y] : [u.x, u.y];
}

/**
 * A hex within one turn's walk (mine-free route, not occupied) that's
 * further from the nearest enemy than here, the furthest such; null if none.
 */
function walkAway(game, u, enemies) {
  const nearestEnemy = (x, y) => Math.min(...enemies.map((e) => distance(x, y, e.x, e.y)));
  let best = null;
  for (const [k, d] of distancesTo(game, u.x, u.y, u.team)) {
    if (d === 0 || d > u.speed) continue;
    const [x, y] = k.split(',').map(Number);
    if (game.unitAt(x, y) || routeTo(game, u, x, y).some(([cx, cy]) => game.mineAt(cx, cy))) continue;
    const away = nearestEnemy(x, y);
    if (!best || away > best.away || (away === best.away && (y < best.y || (y === best.y && x < best.x)))) best = { x, y, away };
  }
  return best && best.away > nearestEnemy(u.x, u.y) ? [best.x, best.y] : null;
}

/**
 * A free, unbuilt hex within one turn's walk (mine-free route) to build on
 * next, preferring hexes further from enemies; null if none.
 */
function freshHex(game, u, enemies) {
  const nearestEnemy = (x, y) => (enemies.length ? Math.min(...enemies.map((e) => distance(x, y, e.x, e.y))) : 0);
  let best = null;
  for (const [k, d] of distancesTo(game, u.x, u.y, u.team)) {
    if (d === 0 || d > u.speed) continue;
    const [x, y] = k.split(',').map(Number);
    if (game.unitAt(x, y) || game.buildingAt(x, y) || routeTo(game, u, x, y).some(([cx, cy]) => game.mineAt(cx, cy))) continue;
    const away = nearestEnemy(x, y);
    if (!best || away > best.away || (away === best.away && (y < best.y || (y === best.y && x < best.x)))) best = { x, y, away };
  }
  return best && [best.x, best.y];
}

/**
 * Where to teleport to get away from enemies: the free, walkable hex within
 * `range` (no mine or projectile on it) that is furthest from the nearest
 * enemy. Ties: lower y, then lower x. Null if nowhere is further than here.
 */
function escapeHex(game, u, range, enemies) {
  const nearestEnemy = (x, y) => Math.min(...enemies.map((e) => distance(x, y, e.x, e.y)));
  let best = null;
  for (let x = 0; x < game.width; x++) {
    for (let y = 0; y < game.height; y++) {
      const d = distance(u.x, u.y, x, y);
      if (d === 0 || d > range) continue;
      if (!game.isWalkable(x, y, u.team) || game.unitAt(x, y) || game.mineAt(x, y) || game.projectileAt(x, y)) continue;
      const away = nearestEnemy(x, y);
      if (!best || away > best.away) best = { x, y, away };
    }
  }
  return best && best.away > nearestEnemy(u.x, u.y) ? [best.x, best.y] : null;
}

/** Direction whose charge-then-strike hits the most enemies and no teammates. */
function bestCharge(game, u, atk, teamCells) {
  let best = null;
  for (const dir of inPriorityOrder(atk.directions)) {
    const plan = chargePlan(game, u, dir);
    if (plan.path.some(([x, y], i) => i > 0 && (teamCells.has(`${x},${y}`) || game.mineAt(x, y)))) continue;
    if (plan.strike.some(([x, y]) => teamCells.has(`${x},${y}`))) continue;
    const enemies = plan.strike.filter(([x, y]) => {
      const occ = game.unitAt(x, y);
      return occ && occ.team !== u.team;
    }).length;
    if (enemies > 0 && (!best || enemies > best.enemies)) best = { dir, enemies };
  }
  return best?.dir ?? null;
}

/** Will this projectile still be in flight after its next flight (board as it stands)? */
function survivesNextFlight(game, p) {
  let [x, y] = [p.x, p.y];
  for (let k = 1; k <= p.speed; k++) {
    [x, y] = step(x, y, p.dir);
    if (!game.inBounds(x, y) || (p.range !== null && p.traveled + k > p.range)) return false;
    if (game.buildingAt(x, y) || game.unitAt(x, y)) return false;
  }
  return true;
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
    if (game.buildingAt(e.x, e.y)) continue; // shots can't reach a unit on a building
    for (const firing of inPriorityOrder(atk.directions)) {
      // A shooter firing `firing` at e stands on the opposite side of e.
      // Walk outward from e; each free cell passed has a clear line back to
      // it. Stop at the first unit (it would block the shot), except u
      // itself, which will have moved away.
      const back = OPPOSITE[firing];
      let [x, y] = step(e.x, e.y, back);
      for (let d = 1; game.inBounds(x, y) && d <= (atk.range ?? Infinity); d++, [x, y] = step(x, y, back)) {
        if (game.buildingAt(x, y)) break; // a building would stop the shot
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
    let stopped = false;
    while (game.inBounds(x, y) && !(x === u.x && y === u.y) && k <= 2 * p.speed) {
      [x, y] = step(x, y, p.dir);
      k += 1;
      if (game.buildingAt(x, y)) { stopped = true; break; } // a building stops it first
    }
    if (stopped || k === 0 || x !== u.x || y !== u.y) continue;
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
      if (game.isWalkable(nx, ny, u.team) && !game.unitAt(nx, ny) && !game.mineAt(nx, ny)) return [nx, ny];
    }
  }
  return null;
}
