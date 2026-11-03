// Core game state and the tick loop.
//
// Determinism rules for the engine:
//   * No Math.random, Date, or other ambient input inside the engine.
//   * Units and projectiles are always processed in ascending id order.
//   * Orders are applied in the order they were queued.
//   * State is plain JSON so it can be snapshotted, hashed and replayed.

import { validateOrder, OrderType } from './orders.js';
import { step, distance, hexLineStep, neighbors } from './hex.js';
import { resolveMoves } from './resolve.js';
import * as Units from './unitTypes.js';
import { getUnitType, AttackKind, MAX_SPEED } from './unitTypes.js';

export { MAX_SPEED };

/** Sides. Friendly fire is on: projectiles hit any unit regardless of team. */
export const Teams = Object.freeze({ PLAYER: 'player', CPU: 'cpu' });


export class Game {
  /**
   * @param {{width:number,height:number,
   *          units?:Array<{x:number,y:number,id?:number,type?:string,team?:string,speed?:number}>}} opts
   */
  constructor({ width, height, units = [] }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('Grid width and height must be positive integers');
    }
    this.state = {
      grid: 'hex', // flat-topped hexes, odd-q offset coordinates (see hex.js)
      width,
      height,
      tick: 0,
      nextUnitId: 1,
      nextOrderSeq: 1, // stamps applied orders so "first ordered" is well defined
      nextProjectileId: 1,
      units: [], // kept sorted by id
      projectiles: [], // kept sorted by id
      queue: [], // [{ unitId, order }]
    };
    for (const u of units) this.addUnit(u.x, u.y, u.id, { type: u.type, team: u.team, speed: u.speed });
  }

  // ---- snapshots ---------------------------------------------------------

  static fromSnapshot(snapshot) {
    const game = new Game({ width: snapshot.width, height: snapshot.height });
    if (snapshot.grid !== 'hex') {
      throw new Error('This save is from the square-grid version of the game and can\'t be loaded on the hex grid');
    }
    game.state = structuredClone(snapshot);
    for (const u of game.state.units) u.quickMoves ??= u.team === Teams.PLAYER ? 1 : 0;
    return game;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  clone() {
    return Game.fromSnapshot(this.state);
  }

  // ---- queries -----------------------------------------------------------

  get width() { return this.state.width; }
  get height() { return this.state.height; }
  get tickCount() { return this.state.tick; }
  get units() { return this.state.units; }
  get projectiles() { return this.state.projectiles; }
  get queue() { return this.state.queue; }

  getUnit(id) {
    return this.state.units.find((u) => u.id === id) ?? null;
  }

  unitAt(x, y) {
    return this.state.units.find((u) => u.x === x && u.y === y) ?? null;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.state.width && y < this.state.height;
  }

  // ---- mutation (between ticks) -------------------------------------------

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} [id] defaults to the next free id
   * @param {{type?:string, team?:string, speed?:number}} [opts]
   *   type: key of UnitTypes (default: the units file's "default").
   *   team: Teams.PLAYER (default) or Teams.CPU.
   *   Player units start with one quick move (see queueOrder); CPU units have none.
   *   speed: cells per tick; defaults to the type's speed. Overriding it is
   *   meant for debugging/tests.
   */
  addUnit(x, y, id, { type = Units.DEFAULT_UNIT_TYPE, team = Teams.PLAYER, speed } = {}) {
    if (!this.inBounds(x, y)) throw new Error(`Cell ${x},${y} is out of bounds`);
    const def = getUnitType(type);
    speed ??= def.speed;
    validateSpeed(speed);
    if (!Object.values(Teams).includes(team)) throw new Error(`Unknown team "${team}"`);
    if (this.unitAt(x, y)) throw new Error(`Cell ${x},${y} is occupied`);
    const unitId = id ?? this.state.nextUnitId;
    if (this.getUnit(unitId)) throw new Error(`Unit id ${unitId} already exists`);
    this.state.nextUnitId = Math.max(this.state.nextUnitId, unitId + 1);
    // orderSeq: when the current order was applied (lower = given earlier).
    const unit = { id: unitId, team, type, x, y, speed, quickMoves: team === Teams.PLAYER ? 1 : 0, order: null, orderSeq: null };
    this.state.units.push(unit);
    this.state.units.sort((a, b) => a.id - b.id);
    return unit;
  }

  setSpeed(id, speed) {
    const unit = this.getUnit(id);
    if (!unit) throw new Error(`No unit with id ${id}`);
    validateSpeed(speed);
    unit.speed = speed;
  }

  removeUnit(id) {
    this.state.units = this.state.units.filter((u) => u.id !== id);
    this.state.queue = this.state.queue.filter((q) => q.unitId !== id);
  }

  /**
   * Queue an order for a unit. It takes effect on the next tick(). A unit has
   * at most one queued order: queueing another replaces it.
   *
   * Quick moves (move orders with `quick: true`) go to the FRONT of the
   * queue, after any other quick moves already there. Being applied first,
   * they count as the earliest-given orders and win same-instant contests
   * for a hex (see resolve.js). The unit's quick move is only used up when
   * the order is applied on tick(), so replacing or clearing it first costs
   * nothing.
   *
   * Throws if the order is invalid (including orders the unit's type can't
   * perform, or a quick move the unit doesn't have) so the UI can report it.
   */
  queueOrder(unitId, order) {
    const unit = this.getUnit(unitId);
    if (!unit) throw new Error(`No unit with id ${unitId}`);
    const err = validateOrder(order, this.state, getUnitType(unit.type));
    if (err) throw new Error(`Invalid order: ${err}`);
    if (order.quick && !(unit.quickMoves > 0)) throw new Error(`Unit ${unitId} has no quick move left`);
    const q = this.state.queue.filter((e) => e.unitId !== unitId);
    const entry = { unitId, order: structuredClone(order) };
    if (order.quick) {
      const firstNonQuick = q.findIndex((e) => !e.order.quick);
      q.splice(firstNonQuick === -1 ? q.length : firstNonQuick, 0, entry);
    } else {
      q.push(entry);
    }
    this.state.queue = q;
  }

  /** Remove queued orders; with a team, only that team's orders. */
  clearQueue(team = null) {
    this.state.queue = team === null
      ? []
      : this.state.queue.filter((q) => this.getUnit(q.unitId)?.team !== team);
  }

  // ---- simulation --------------------------------------------------------

  /**
   * Advance the simulation by one tick.
   *
   * 1. Apply queued orders (only the last one per unit, in queue order).
   *    - move: becomes the unit's standing order. A quick move also uses up
   *      one of the unit's quick moves; it was queued at the front, so it
   *      gets the lowest order number and wins same-instant contests for as
   *      long as the unit follows it.
   *    - attack: the unit holds still this tick and any move order is
   *      cancelled. What happens depends on its type's attack kind:
   *        projectile: a projectile is fired from the unit's cell right away;
   *        melee: the unit strikes at the END of the tick (see 2e).
   *
   * 2. Run the tick as a sequence of instants ("sub-steps"). Anything with
   *    speed v (units and projectiles) takes one step at each of the times
   *    1/v, 2/v, ..., 1. With L = lcm of all speeds, sub-step j is at time
   *    j/L; integer math only, so it is exact and deterministic. At each
   *    instant:
   *      a. Units stepping now pick their next cell toward their target and
   *         are resolved together with the single-step collision rules (see
   *         resolve.js); everyone else holds their cell. Whoever got to a cell
   *         first keeps it; no one can jump over anyone. Projectiles never
   *         block units.
   *      b. Projectiles stepping now advance one cell in their direction.
   *         They never steer and are never blocked.
   *      c. Hits: a projectile hits a unit if, after (a) and (b), they share
   *         a cell (other than a projectile still sitting in its shooter's
   *         cell), or if they passed through each other this instant (unit
   *         moved P'->P while the projectile moved P->P'). The unit is killed
   *         and removed at once, freeing its cell; the projectile is used up.
   *         Projectiles don't interact with each other.
   *      d. Projectiles that left the grid or went past their range are
   *         removed.
   *      e. At the last instant (t = 1) only, at the same moment as that
   *         instant's projectile hits: each melee attacker still alive kills
   *         every unit in the `reach` cells in a row next to it in its
   *         direction (friendly fire included). Units that left those cells
   *         earlier escape; units that walked in get hit.
   *    A unit blocked at one of its sub-steps retries at its next one.
   *
   * 3. Units that reached their target drop their order.
   *
   * Returns the list of events. Each unit produces at most one "moved"
   * event (full path) and at most one "blocked" event (first time it was
   * blocked); each projectile at most one "projectileMoved" event.
   */
  tick() {
    const s = this.state;
    const events = [];

    // 1. Apply queued orders: last one per unit wins.
    const strikes = []; // melee attacks [{ unitId, dir }], landing at t = 1
    const lastIndex = new Map();
    s.queue.forEach((q, i) => lastIndex.set(q.unitId, i));
    s.queue.forEach(({ unitId, order }, i) => {
      if (lastIndex.get(unitId) !== i) return;
      const unit = this.getUnit(unitId);
      if (!unit) {
        events.push({ type: 'orderDropped', unitId, reason: 'unit missing' });
        return;
      }
      events.push({ type: 'orderApplied', unitId, order });
      if (order.type === OrderType.ATTACK) {
        unit.order = null;
        unit.orderSeq = null;
        const atk = getUnitType(unit.type).attack;
        if (atk.kind === AttackKind.PROJECTILE) {
          const p = {
            id: s.nextProjectileId++,
            ownerId: unit.id,
            x: unit.x,
            y: unit.y,
            dir: order.dir,
            speed: atk.speed,
            range: atk.range,
            traveled: 0,
          };
          s.projectiles.push(p);
          events.push({ type: 'shot', unitId: unit.id, projectileId: p.id, dir: p.dir, from: [p.x, p.y] });
        } else if (atk.kind === AttackKind.MELEE) {
          strikes.push({ unitId: unit.id, dir: order.dir });
        }
      } else {
        unit.order = order;
        unit.orderSeq = s.nextOrderSeq++;
        if (order.quick) {
          unit.quickMoves -= 1;
          events.push({ type: 'quickMove', unitId: unit.id, to: [order.x, order.y], remaining: unit.quickMoves });
        }
      }
    });
    s.queue = [];

    // 2. Sub-steps.
    const L = [...s.units, ...s.projectiles].reduce((acc, e) => lcm(acc, e.speed), 1);
    const startUnits = [...s.units];
    const paths = new Map(s.units.map((u) => [u.id, [[u.x, u.y]]]));
    const projPaths = new Map(s.projectiles.map((p) => [p.id, [[p.x, p.y]]]));
    const firstBlock = new Map();
    const stepsAt = (e, j) => j % (L / e.speed) === 0;

    for (let j = 1; j <= L; j++) {
      const time = fraction(j, L);

      // a. Units.
      const movedFrom = new Map(); // unit id -> cell it left this instant
      const intents = s.units.map((u) => {
        const next = stepsAt(u, j) ? nextStep(u, s) : { x: u.x, y: u.y };
        return { id: u.id, x: u.x, y: u.y, tx: next.x, ty: next.y, priority: u.orderSeq };
      });
      if (intents.some((it) => it.tx !== it.x || it.ty !== it.y)) {
        const outcome = resolveMoves(intents);
        for (const u of s.units) {
          const r = outcome.get(u.id);
          if (r.moved) {
            movedFrom.set(u.id, [u.x, u.y]);
            u.x = r.x;
            u.y = r.y;
            paths.get(u.id).push([u.x, u.y]);
          } else if (r.blocked && !firstBlock.has(u.id)) {
            firstBlock.set(u.id, { at: [u.x, u.y], ...r.blocked, time });
          }
        }
      }

      // b. Projectiles.
      const projFrom = new Map(); // projectile id -> cell it left this instant
      for (const p of s.projectiles) {
        if (!stepsAt(p, j)) continue;
        projFrom.set(p.id, [p.x, p.y]);
        [p.x, p.y] = step(p.x, p.y, p.dir);
        p.traveled += 1;
        if (this.inBounds(p.x, p.y) && !pastRange(p)) projPaths.get(p.id).push([p.x, p.y]);
      }

      // c. Hits (all decided for this instant before anything is removed).
      const hits = []; // [projectile, victim]
      for (const p of s.projectiles) {
        if (!this.inBounds(p.x, p.y) || pastRange(p)) continue;
        let victim = s.units.find((u) => u.x === p.x && u.y === p.y && !(p.traveled === 0 && u.id === p.ownerId));
        const from = projFrom.get(p.id);
        if (!victim && from) {
          victim = s.units.find((u) => {
            const uf = movedFrom.get(u.id);
            return uf && uf[0] === p.x && uf[1] === p.y && u.x === from[0] && u.y === from[1];
          });
        }
        if (victim) hits.push([p, victim]);
      }
      const killed = new Map(); // unit id -> [{ cause, sourceId, attackerId }]
      const addKill = (victimId, hit) => {
        if (!killed.has(victimId)) killed.set(victimId, []);
        killed.get(victimId).push(hit);
      };
      for (const [p, victim] of hits) {
        addKill(victim.id, { cause: 'projectile', sourceId: p.id, attackerId: p.ownerId });
      }

      // e. Melee strikes land at the end of the tick, simultaneously with
      //    this instant's projectile hits (a striker shot at t=1 still strikes).
      if (j === L) {
        for (const t of strikes) {
          const attacker = this.getUnit(t.unitId);
          if (!attacker) continue; // killed earlier this tick
          const cells = strikeCells(attacker, t.dir, getUnitType(attacker.type).attack.reach);
          events.push({ type: 'strike', unitId: attacker.id, dir: t.dir, cells: cells.filter(([x, y]) => this.inBounds(x, y)) });
          for (const [x, y] of cells) {
            const victim = this.unitAt(x, y);
            if (victim) addKill(victim.id, { cause: 'melee', sourceId: attacker.id, attackerId: attacker.id });
          }
        }
      }

      for (const [unitId, hitsOn] of [...killed].sort((a, b) => a[0] - b[0])) {
        const u = this.getUnit(unitId);
        const shots = hitsOn.filter((h) => h.cause === 'projectile');
        events.push({
          type: 'killed',
          unitId,
          team: u.team,
          at: [u.x, u.y],
          time,
          hits: hitsOn,
          // Shortcuts for projectile kills.
          by: shots.map((h) => h.sourceId),
          shooterId: shots[0]?.attackerId ?? null,
        });
      }
      const spent = new Set(hits.map(([p]) => p.id));
      s.units = s.units.filter((u) => !killed.has(u.id));

      // d. Remove spent projectiles and ones that left the grid.
      s.projectiles = s.projectiles.filter((p) => {
        if (spent.has(p.id)) return false;
        if (!this.inBounds(p.x, p.y) || pastRange(p)) {
          events.push({ type: 'projectileExpired', projectileId: p.id, time });
          return false;
        }
        return true;
      });
    }

    // 3. Report and clear finished orders.
    for (const [id, path] of projPaths) {
      if (path.length > 1) events.push({ type: 'projectileMoved', projectileId: id, path });
    }
    for (const u of startUnits) {
      const path = paths.get(u.id);
      if (path.length > 1) {
        events.push({ type: 'moved', unitId: u.id, from: path[0], to: path[path.length - 1], path });
      }
      const b = firstBlock.get(u.id);
      if (b) {
        events.push({ type: 'blocked', unitId: u.id, at: b.at, reason: b.reason, by: b.by, time: b.time });
      }
      if (!this.getUnit(u.id)) continue; // killed this tick
      if (u.order?.type === OrderType.MOVE && u.x === u.order.x && u.y === u.order.y) {
        events.push({ type: 'arrived', unitId: u.id, at: [u.x, u.y] });
        u.order = null;
        u.orderSeq = null;
      }
    }

    s.tick += 1;
    return events;
  }

  /** Stable hash of the full state; equal states always hash equal. */
  hash() {
    return hashState(this.state);
  }
}


/** A projectile that has flown further than its range is spent. */
const pastRange = (p) => p.range !== null && p.traveled > p.range;

/** The `reach` cells in a row next to a unit in a direction. */
export function strikeCells(unit, dir, reach) {
  const cells = [];
  let [x, y] = [unit.x, unit.y];
  for (let k = 1; k <= reach; k++) {
    [x, y] = step(x, y, dir);
    cells.push([x, y]);
  }
  return cells;
}

function validateSpeed(speed) {
  if (!Number.isInteger(speed) || speed < 1 || speed > MAX_SPEED) {
    throw new Error(`Speed must be an integer from 1 to ${MAX_SPEED}`);
  }
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** j/L as a reduced fraction string, e.g. "1/2", or "1" for a whole tick. */
function fraction(j, L) {
  const g = gcd(j, L);
  return L / g === 1 ? String(j / g) : `${j / g}/${L / g}`;
}

function lcm(a, b) {
  return (a / gcd(a, b)) * b;
}

/**
 * The cell a unit wants to enter on its next step: one hex toward its move
 * target along a straight hex line. If that cell is off the board (lines can
 * clip the board's zig-zag edges), the in-board neighbour that gets closest
 * to the target is used instead (ties: direction order in hex.js). No
 * pathfinding around units yet: a blocked unit tries again on its next step.
 *
 * @param {{x:number,y:number,order:object|null}} unit
 * @param {{width:number,height:number}} [board] bounds; omit for unbounded
 */
export function nextStep(unit, board = null) {
  const o = unit.order;
  if (!o || o.type !== OrderType.MOVE) return { x: unit.x, y: unit.y };
  if (o.x === unit.x && o.y === unit.y) return { x: unit.x, y: unit.y };
  const inside = (x, y) => !board || (x >= 0 && y >= 0 && x < board.width && y < board.height);
  const [lx, ly] = hexLineStep(unit.x, unit.y, o.x, o.y);
  if (inside(lx, ly)) return { x: lx, y: ly };
  let best = null;
  for (const [, x, y] of neighbors(unit.x, unit.y)) {
    if (!inside(x, y)) continue;
    const d = distance(x, y, o.x, o.y);
    if (!best || d < best.d) best = { x, y, d };
  }
  return best && best.d < distance(unit.x, unit.y, o.x, o.y) ? { x: best.x, y: best.y } : { x: unit.x, y: unit.y };
}

/** Canonical JSON (sorted keys) so key insertion order can't change hashes. */
export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 32-bit FNV-1a over the canonical JSON, as 8 hex chars. */
export function hashState(state) {
  const str = canonicalJSON(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
