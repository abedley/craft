// Core game state and the tick loop.
//
// Determinism rules for the engine:
//   * No Math.random, Date, or other ambient input inside the engine.
//   * Units and projectiles are always processed in ascending id order.
//   * Orders are applied in the order they were queued.
//   * State is plain JSON so it can be snapshotted, hashed and replayed.

import { validateOrder, OrderType, Directions } from './orders.js';
import { resolveMoves } from './resolve.js';
import { getUnitType, DEFAULT_UNIT_TYPE } from './unitTypes.js';

/** Fastest allowed unit speed, in cells per tick. */
export const MAX_SPEED = 6;

export class Game {
  /**
   * @param {{width:number,height:number,
   *          units?:Array<{x:number,y:number,id?:number,type?:string,speed?:number}>}} opts
   */
  constructor({ width, height, units = [] }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('Grid width and height must be positive integers');
    }
    this.state = {
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
    for (const u of units) this.addUnit(u.x, u.y, u.id, { type: u.type, speed: u.speed });
  }

  // ---- snapshots ---------------------------------------------------------

  static fromSnapshot(snapshot) {
    const game = new Game({ width: snapshot.width, height: snapshot.height });
    game.state = structuredClone(snapshot);
    // Fill in fields that older snapshots don't have.
    game.state.nextOrderSeq ??= 1;
    game.state.nextProjectileId ??= 1;
    game.state.projectiles ??= [];
    for (const u of game.state.units) {
      u.orderSeq ??= null;
      u.type ??= DEFAULT_UNIT_TYPE;
      u.speed ??= getUnitType(u.type).speed;
    }
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
   * @param {{type?:string, speed?:number}} [opts]
   *   type: key of UnitTypes (default "basic").
   *   speed: cells per tick; defaults to the type's speed. Overriding it is
   *   meant for debugging/tests.
   */
  addUnit(x, y, id, { type = DEFAULT_UNIT_TYPE, speed } = {}) {
    if (!this.inBounds(x, y)) throw new Error(`Cell ${x},${y} is out of bounds`);
    const def = getUnitType(type);
    speed ??= def.speed;
    validateSpeed(speed);
    if (this.unitAt(x, y)) throw new Error(`Cell ${x},${y} is occupied`);
    const unitId = id ?? this.state.nextUnitId;
    if (this.getUnit(unitId)) throw new Error(`Unit id ${unitId} already exists`);
    this.state.nextUnitId = Math.max(this.state.nextUnitId, unitId + 1);
    // orderSeq: when the current order was applied (lower = given earlier).
    const unit = { id: unitId, type, x, y, speed, order: null, orderSeq: null };
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
   * Queue an order for a unit. It takes effect on the next tick(). If the
   * same unit is given several orders before a tick, only the last one is
   * carried out. Throws if the order is invalid (including orders the unit's
   * type can't perform) so the UI can report it immediately.
   */
  queueOrder(unitId, order) {
    const unit = this.getUnit(unitId);
    if (!unit) throw new Error(`No unit with id ${unitId}`);
    const err = validateOrder(order, this.state, getUnitType(unit.type));
    if (err) throw new Error(`Invalid order: ${err}`);
    this.state.queue.push({ unitId, order: structuredClone(order) });
  }

  clearQueue() {
    this.state.queue = [];
  }

  // ---- simulation --------------------------------------------------------

  /**
   * Advance the simulation by one tick.
   *
   * 1. Apply queued orders (only the last one per unit, in queue order).
   *    - move: becomes the unit's standing order.
   *    - shoot: fires a projectile from the unit's cell right away and
   *      cancels any move order; the unit holds still this tick.
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
   *      d. Projectiles that left the grid are removed.
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
      if (order.type === OrderType.SHOOT) {
        unit.order = null;
        unit.orderSeq = null;
        const p = {
          id: s.nextProjectileId++,
          ownerId: unit.id,
          x: unit.x,
          y: unit.y,
          dir: order.dir,
          speed: getUnitType(unit.type).projectile.speed,
          traveled: 0,
        };
        s.projectiles.push(p);
        events.push({ type: 'shot', unitId: unit.id, projectileId: p.id, dir: p.dir, from: [p.x, p.y] });
      } else {
        unit.order = order;
        unit.orderSeq = s.nextOrderSeq++;
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
        const next = stepsAt(u, j) ? nextStep(u) : { x: u.x, y: u.y };
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
        const [dx, dy] = Directions[p.dir];
        projFrom.set(p.id, [p.x, p.y]);
        p.x += dx;
        p.y += dy;
        p.traveled += 1;
        if (this.inBounds(p.x, p.y)) projPaths.get(p.id).push([p.x, p.y]);
      }

      // c. Hits (all decided for this instant before anything is removed).
      const hits = []; // [projectile, victim]
      for (const p of s.projectiles) {
        if (!this.inBounds(p.x, p.y)) continue;
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
      const killed = new Map(); // unit id -> projectile ids that hit it
      for (const [p, victim] of hits) {
        if (!killed.has(victim.id)) killed.set(victim.id, []);
        killed.get(victim.id).push(p.id);
      }
      for (const [unitId, by] of [...killed].sort((a, b) => a[0] - b[0])) {
        const u = this.getUnit(unitId);
        const p = s.projectiles.find((q) => q.id === by[0]);
        events.push({ type: 'killed', unitId, at: [u.x, u.y], by, shooterId: p.ownerId, time });
      }
      const spent = new Set(hits.map(([p]) => p.id));
      s.units = s.units.filter((u) => !killed.has(u.id));

      // d. Remove spent projectiles and ones that left the grid.
      s.projectiles = s.projectiles.filter((p) => {
        if (spent.has(p.id)) return false;
        if (!this.inBounds(p.x, p.y)) {
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
 * The cell a unit wants to enter on its next step. Moves one cell orthogonally,
 * closing the larger axis gap first (x on ties). No pathfinding yet: a
 * blocked unit simply tries again on its next step.
 */
export function nextStep(unit) {
  const o = unit.order;
  if (!o || o.type !== OrderType.MOVE) return { x: unit.x, y: unit.y };
  const dx = o.x - unit.x;
  const dy = o.y - unit.y;
  if (dx === 0 && dy === 0) return { x: unit.x, y: unit.y };
  if (Math.abs(dx) >= Math.abs(dy)) return { x: unit.x + Math.sign(dx), y: unit.y };
  return { x: unit.x, y: unit.y + Math.sign(dy) };
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
