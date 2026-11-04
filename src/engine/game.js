// Core game state and the turn loop.
//
// THE QUEUE DECIDES EVERYTHING. A turn (tick) runs the order queue from front
// to back; each entry is carried out completely, against the board exactly as
// the entries before it left it, before the next one starts. There are no
// hidden phases or simultaneous resolution: whatever is earlier in the queue
// happens first.
//
// Queue entries:
//   { unitId, order }      a unit's order (move or attack)
//   { projectileId }       a projectile still in flight from an earlier turn
// An entry may also carry `carried: true` (a projectile from last turn).
//
// How the queue is built each turn (see queueOrder):
//   - It starts empty. Projectiles still in flight and builders' channels
//     from last turn are added first, in the order they ran.
//   - Every new order joins the END of the queue, in the order given. (In a
//     match the CPU stages its plan at the start of the turn, so its orders
//     are added before the player's; see match.js.)
//   - "Fast" orders, quick moves and charges, are added to the FRONT instead.
//   - Nothing ever reorders the queue. Giving a unit a new order removes its
//     old entry (a unit has at most one); no other entry moves.
//
// What each entry does when its turn comes:
//   move        The unit walks to its target along its route. A move can only
//               be given to a hex within the unit's `speed` (walking
//               distance), so it's always a single turn's walk. It stops
//               early if the next hex is occupied (whoever is there got there
//               first). Walking into a hex with a projectile in it is a hit.
//               Nothing carries over: multi-turn walks are for a front end to
//               break into one move per turn.
//   attack      projectile kind: a projectile is fired from the unit's hex
//               and immediately flies up to its `speed` hexes, killing the
//               first unit it meets. Still flying? It carries over.
//               melee kind: every unit in the `reach` hexes in a row next to
//               the attacker is killed, right now (friendly fire included).
//               A gunslinger can't fire while one of its shots is still in
//               flight (`maxInFlight`); it can again once that shot has hit
//               or left the board, even earlier in the same queue.
//               If the type's attack is `blockedByAdjacentEnemy` (gunslingers)
//               and an enemy is next to the attacker when the entry runs,
//               the attack fails and nothing happens. A shot already fired
//               (earlier in the queue, or still flying from a previous turn)
//               is not affected.
//   charge      The unit rushes in a straight line in the chosen direction,
//               up to its type's charge distance (3 for pikemen). It stops
//               early if the next hex holds a unit (a collision) or is
//               unwalkable or off the board. Wherever it stops, it then makes
//               its attack in the same direction, so a pikeman that collides
//               strikes the unit it ran into (friendly fire included). Running
//               into a projectile in flight is a hit. Nothing carries over.
//   teleport    The unit jumps straight to its target hex (up to its type's
//               teleport distance away; what's in between doesn't matter). If
//               that hex has been taken earlier in the queue, nothing happens.
//               A stalker leaves a MINE on the hex it left. It can't teleport
//               while it already has its maximum of mines (2) on the board.
//   projectile  (carried over) flies another `speed` hexes the same way.
//
// Build (builders): the unit channels on its own hex for its type's `build`
// turns (2). Each turn its build entry adds one turn of progress and, until
// done, carries itself over to the next turn's queue (with the projectiles,
// at the start). On the last turn a building appears on that hex. Giving the
// unit any other order breaks the channel and its progress is lost.
// Buildings: allied units can walk on or through them; to enemy units they
// are impassable, like water. They also STOP PROJECTILES (either team's):
// a shot that flies into a building hex is used up there, and a unit standing
// on that hex is not hit. A shot fired from a building flies out normally.
// Strikes and mines ignore buildings.
//
// Mines: any unit (either team, the stalker too) that moves onto a mined hex
// by walking, charging through or teleporting onto it, sets it off and is
// killed; the mine is used up. Shots fly over mines.
//
// Determinism: no randomness, clock or DOM; state is plain JSON.

import { validateOrder, OrderType, goesToFront } from './orders.js';
import { step, hexLineStep, neighbors, distance as hexDistance } from './hex.js';
import * as Units from './unitTypes.js';
import { getUnitType, AttackKind, MAX_SPEED } from './unitTypes.js';
import * as Terrain from './terrain.js';
import { getTerrainType, terrainForChar } from './terrain.js';

export { MAX_SPEED };

/** Sides. Friendly fire is on: attacks hit any unit regardless of team. */
export const Teams = Object.freeze({ PLAYER: 'player', CPU: 'cpu' });

export class Game {
  /**
   * @param {{width:number,height:number,
   *          terrain?:string[],
   *          units?:Array<{x:number,y:number,id?:number,type?:string,team?:string,speed?:number}>}} opts
   *   terrain: one string per row, one character per hex, using each terrain
   *   type's "char" (see terrain.js), e.g. "..==~~..". Omit for all-default.
   */
  constructor({ width, height, units = [], terrain = null }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('Grid width and height must be positive integers');
    }
    this.state = {
      grid: 'hex', // flat-topped hexes, odd-q offset coordinates (see hex.js)
      queueVersion: 2, // sequential queue model
      width,
      height,
      tick: 0,
      nextUnitId: 1,
      nextProjectileId: 1,
      nextMineId: 1,
      nextBuildingId: 1,
      units: [], // kept sorted by id
      projectiles: [], // kept sorted by id
      mines: [], // [{ id, x, y, ownerId, team }] (see teleport)
      buildings: [], // [{ id, x, y, team, builderId }] (see build)
      queue: [], // see the top of this file
      // Terrain type key per hex, row-major: terrain[y * width + x].
      terrain: parseTerrain(terrain, width, height),
    };
    for (const u of units) this.addUnit(u.x, u.y, u.id, { type: u.type, team: u.team, speed: u.speed });
  }

  // ---- snapshots ---------------------------------------------------------

  static fromSnapshot(snapshot) {
    const game = new Game({ width: snapshot.width, height: snapshot.height });
    if (snapshot.grid !== 'hex') {
      throw new Error('This save is from the square-grid version of the game and can\'t be loaded on the hex grid');
    }
    if (snapshot.queueVersion !== 2) {
      throw new Error('This save is from an older version of the turn rules and can\'t be loaded');
    }
    game.state = structuredClone(snapshot);
    game.state.mines ??= [];
    game.state.buildings ??= [];
    game.state.nextBuildingId ??= 1;
    for (const u of game.state.units) u.channel ??= null;
    game.state.nextMineId ??= 1;
    for (const u of game.state.units) u.teleports ??= getUnitType(u.type).teleport ? (getUnitType(u.type).teleport.uses ?? null) : 0;
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
  get terrain() { return this.state.terrain; }

  getUnit(id) {
    return this.state.units.find((u) => u.id === id) ?? null;
  }

  getProjectile(id) {
    return this.state.projectiles.find((p) => p.id === id) ?? null;
  }

  unitAt(x, y) {
    return this.state.units.find((u) => u.x === x && u.y === y) ?? null;
  }

  get mines() { return this.state.mines; }
  get buildings() { return this.state.buildings; }

  buildingAt(x, y) {
    return this.state.buildings.find((b) => b.x === x && b.y === y) ?? null;
  }

  /** Mines on the board laid by this unit. */
  minesOf(unitId) {
    return this.state.mines.filter((m) => m.ownerId === unitId);
  }

  /** Projectiles in flight fired by this unit. */
  projectilesOf(unitId) {
    return this.state.projectiles.filter((p) => p.ownerId === unitId);
  }

  mineAt(x, y) {
    return this.state.mines.find((m) => m.x === x && m.y === y) ?? null;
  }

  projectileAt(x, y) {
    return this.state.projectiles.find((p) => p.x === x && p.y === y) ?? null;
  }

  /** The unit's queue entry, if it has one. */
  entryFor(unitId) {
    return this.state.queue.find((e) => e.unitId === unitId) ?? null;
  }

  /** The unit's queued order, or null. */
  orderFor(unitId) {
    return this.entryFor(unitId)?.order ?? null;
  }

  /** Terrain type key of a hex. */
  terrainAt(x, y) {
    if (!this.inBounds(x, y)) throw new Error(`Cell ${x},${y} is out of bounds`);
    return this.state.terrain[y * this.state.width + x];
  }

  /**
   * Can a unit stand on this hex (on the board and walkable terrain)? With a
   * team: and not the other team's building.
   */
  isWalkable(x, y, team = null) {
    return isWalkable(this.state, x, y, team);
  }

  /** Why a unit of `team` can't stand on (x, y), for error messages. */
  notWalkableReason(x, y, team = null) {
    if (!this.inBounds(x, y)) return 'off the board';
    if (!getTerrainType(this.terrainAt(x, y)).walkable) return getTerrainType(this.terrainAt(x, y)).name;
    return 'an enemy building';
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.state.width && y < this.state.height;
  }

  // ---- editing (between turns) ---------------------------------------------

  /** Change one hex's terrain. Can't make an occupied hex unwalkable. */
  setTerrain(x, y, type) {
    if (!this.inBounds(x, y)) throw new Error(`Cell ${x},${y} is out of bounds`);
    const def = getTerrainType(type);
    const unit = this.unitAt(x, y);
    if (unit && !def.walkable) throw new Error(`Unit ${unit.id} is standing on ${x},${y}`);
    this.state.terrain[y * this.state.width + x] = type;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} [id] defaults to the next free id
   * @param {{type?:string, team?:string, speed?:number}} [opts]
   *   type: key of UnitTypes (default: the units file's "default").
   *   team: Teams.PLAYER (default) or Teams.CPU.
   *   Player units start with one quick move (see queueOrder); CPU units have none.
   *   Units whose type has a charge start with its `uses` charges (either team).
   *   speed: hexes per move; defaults to the type's speed. Overriding it is
   *   meant for debugging/tests.
   */
  addUnit(x, y, id, { type = Units.DEFAULT_UNIT_TYPE, team = Teams.PLAYER, speed } = {}) {
    if (!this.inBounds(x, y)) throw new Error(`Cell ${x},${y} is out of bounds`);
    const def = getUnitType(type);
    speed ??= def.speed;
    validateSpeed(speed);
    if (!Object.values(Teams).includes(team)) throw new Error(`Unknown team "${team}"`);
    if (this.unitAt(x, y)) throw new Error(`Cell ${x},${y} is occupied`);
    if (!this.isWalkable(x, y, team)) throw new Error(`Units can't stand on ${this.notWalkableReason(x, y, team)}`);
    const unitId = id ?? this.state.nextUnitId;
    if (this.getUnit(unitId)) throw new Error(`Unit id ${unitId} already exists`);
    this.state.nextUnitId = Math.max(this.state.nextUnitId, unitId + 1);
    const unit = {
      id: unitId, team, type, x, y, speed,
      quickMoves: team === Teams.PLAYER ? 1 : 0,
      charges: def.charge?.uses ?? 0,
      // Teleports left: null = unlimited, 0 = none.
      teleports: def.teleport ? (def.teleport.uses ?? null) : 0,
      // A multi-turn action in progress, e.g. { kind: 'build', progress: 1 }.
      channel: null,
    };
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
   * Queue an order for a unit. A unit has at most one queue entry: a new
   * order replaces its old one.
   *
   * Placement: fast orders (quick moves and charges) go to the very front;
   * any other order joins the end. Nothing else in the queue moves. A quick
   * move or charge is only used up when it
   * runs, so replacing or clearing it first costs nothing.
   *
   * Throws if the order is invalid (wrong for the unit's type, a move onto
   * unwalkable terrain, or a quick move or charge the unit doesn't have).
   */
  queueOrder(unitId, order) {
    const unit = this.getUnit(unitId);
    if (!unit) throw new Error(`No unit with id ${unitId}`);
    const err = validateOrder(order, this.state, getUnitType(unit.type));
    if (err) throw new Error(`Invalid order: ${err}`);
    if (order.type === OrderType.MOVE) {
      if (!this.isWalkable(order.x, order.y, unit.team)) {
        throw new Error(`Invalid order: units can't walk on ${this.notWalkableReason(order.x, order.y, unit.team)}`);
      }
      // One turn's walk at most: the target must be within the unit's speed
      // (walking distance around terrain and enemy buildings; other units
      // don't count).
      const d = distancesTo(this.state, order.x, order.y, unit.team).get(`${unit.x},${unit.y}`);
      if (d === undefined) throw new Error(`Invalid order: unit ${unitId} has no route to ${order.x},${order.y}`);
      if (d > unit.speed) {
        throw new Error(`Invalid order: too far. Unit ${unitId} can move up to ${unit.speed} hex${unit.speed === 1 ? '' : 'es'} this turn (${order.x},${order.y} is ${d} away)`);
      }
    }
    if (order.type === OrderType.TELEPORT) {
      const tp = getUnitType(unit.type).teleport;
      if (unit.teleports === 0) throw new Error(`Unit ${unitId} has no teleport left`);
      if (!this.isWalkable(order.x, order.y, unit.team)) {
        throw new Error(`Invalid order: units can't stand on ${this.notWalkableReason(order.x, order.y, unit.team)}`);
      }
      const d = hexDistance(unit.x, unit.y, order.x, order.y);
      if (d === 0) throw new Error('Invalid order: teleport somewhere else');
      if (d > tp.distance) {
        throw new Error(`Invalid order: too far. Unit ${unitId} can teleport up to ${tp.distance} hexes (${order.x},${order.y} is ${d} away)`);
      }
    }
    if (order.type === OrderType.BUILD && this.buildingAt(unit.x, unit.y)) {
      throw new Error(`Invalid order: there's already a building at ${unit.x},${unit.y}`);
    }
    if (order.quick && !(unit.quickMoves > 0)) throw new Error(`Unit ${unitId} has no quick move left`);
    if (order.type === OrderType.CHARGE && !(unit.charges > 0)) throw new Error(`Unit ${unitId} has no charge left`);
    const q = this.state.queue.filter((e) => e.unitId !== unitId);
    const entry = { unitId, order: structuredClone(order) };
    if (goesToFront(order)) q.unshift(entry); // fast: to the very front
    else q.push(entry); // everything else: to the end
    this.state.queue = q;
  }

  /**
   * Remove unit orders from the queue; with a team, only that team's.
   * Projectiles in flight are never removed. With `keepCarried`, orders
   * carried over from last turn (a builder's channel) are kept too.
   */
  clearQueue(team = null, { keepCarried = false } = {}) {
    this.state.queue = this.state.queue.filter((e) => {
      if (e.projectileId !== undefined) return true;
      if (keepCarried && e.carried) return true;
      return team !== null && this.getUnit(e.unitId)?.team !== team;
    });
  }

  // ---- the turn ------------------------------------------------------------

  /**
   * Run the queue front to back (see the top of this file). Every event has
   * `step`: the 1-based position in the queue of the entry that caused it.
   * Projectiles still in flight afterwards become next turn's queue, marked
   * `carried`, in the order they
   * ran. Returns the events.
   */
  tick() {
    const s = this.state;
    const events = [];
    const carried = [];
    const channelled = new Set(); // units whose channel continued this turn

    s.queue.forEach((entry, i) => {
      const stepNo = i + 1;
      if (entry.projectileId !== undefined) {
        const p = this.getProjectile(entry.projectileId);
        if (p && this.fly(p, events, stepNo)) carried.push({ projectileId: p.id, carried: true });
        return;
      }

      const unit = this.getUnit(entry.unitId);
      if (!unit) {
        events.push({ type: 'orderDropped', step: stepNo, unitId: entry.unitId, reason: 'unit gone' });
        return;
      }
      const { order } = entry;
      events.push({ type: 'orderStarted', step: stepNo, unitId: unit.id, order, carried: !!entry.carried });

      if (order.type === OrderType.MOVE) {
        if (order.quick) {
          unit.quickMoves -= 1;
          events.push({ type: 'quickMove', step: stepNo, unitId: unit.id, remaining: unit.quickMoves });
        }
        this.walk(unit, order, events, stepNo);
        return;
      }

      if (order.type === OrderType.BUILD) {
        const turns = getUnitType(unit.type).build.turns;
        if (this.buildingAt(unit.x, unit.y)) {
          events.push({ type: 'blocked', step: stepNo, unitId: unit.id, at: [unit.x, unit.y], reason: 'already built', by: null });
          return;
        }
        const progress = (unit.channel?.kind === 'build' ? unit.channel.progress : 0) + 1;
        channelled.add(unit.id);
        if (progress < turns) {
          unit.channel = { kind: 'build', progress };
          events.push({ type: 'channeling', step: stepNo, unitId: unit.id, kind: 'build', progress, of: turns });
          carried.push({ unitId: unit.id, order, carried: true });
        } else {
          unit.channel = null;
          const b = { id: s.nextBuildingId++, x: unit.x, y: unit.y, team: unit.team, builderId: unit.id };
          s.buildings.push(b);
          events.push({ type: 'built', step: stepNo, unitId: unit.id, buildingId: b.id, at: [b.x, b.y] });
        }
        return;
      }

      if (order.type === OrderType.TELEPORT) {
        const tpDef = getUnitType(unit.type).teleport;
        if (tpDef.leavesMine && tpDef.maxMines !== null && this.minesOf(unit.id).length >= tpDef.maxMines) {
          // It couldn't lay a mine, so it can't teleport.
          events.push({ type: 'blocked', step: stepNo, unitId: unit.id, at: [unit.x, unit.y], reason: 'mine limit', by: null });
          return;
        }
        const occupant = this.unitAt(order.x, order.y);
        if (occupant) {
          // The landing hex was taken earlier in the queue: nothing happens.
          events.push({ type: 'blocked', step: stepNo, unitId: unit.id, at: [unit.x, unit.y], reason: 'occupied', by: occupant.id });
          return;
        }
        if (unit.teleports !== null) unit.teleports -= 1;
        const from = [unit.x, unit.y];
        const tp = getUnitType(unit.type).teleport;
        const hazard = this.enterHex(unit, order.x, order.y);
        events.push({ type: 'teleported', step: stepNo, unitId: unit.id, from, to: [unit.x, unit.y] });
        if (tp.leavesMine) {
          const mine = { id: this.state.nextMineId++, x: from[0], y: from[1], ownerId: unit.id, team: unit.team };
          this.state.mines.push(mine);
          events.push({ type: 'minePlaced', step: stepNo, mineId: mine.id, unitId: unit.id, at: from });
        }
        if (hazard) this.setOff(unit, hazard, events, stepNo);
        return;
      }

      if (order.type === OrderType.CHARGE) {
        unit.charges -= 1;
        events.push({ type: 'charge', step: stepNo, unitId: unit.id, dir: order.dir, remaining: unit.charges });
        const plan = chargePlan(this, unit, order.dir);
        const path = [[unit.x, unit.y]];
        for (const [x, y] of plan.path.slice(1)) {
          const hazard = this.enterHex(unit, x, y);
          path.push([x, y]);
          if (hazard) {
            // Charged into a projectile in flight or onto a mine: no strike.
            events.push({ type: 'moved', step: stepNo, unitId: unit.id, from: path[0], to: [x, y], path });
            this.setOff(unit, hazard, events, stepNo);
            return;
          }
        }
        if (path.length > 1) events.push({ type: 'moved', step: stepNo, unitId: unit.id, from: path[0], to: path[path.length - 1], path });
        events.push({ type: 'chargeEnded', step: stepNo, unitId: unit.id, reason: plan.reason, by: plan.by });
        // The charge ends with the unit's attack, in the charge direction.
        const shot = this.performAttack(unit, order.dir, events, stepNo);
        if (shot) carried.push(shot);
        return;
      }

      const shot = this.performAttack(unit, order.dir, events, stepNo);
      if (shot) carried.push(shot);
    });

    // A channel that wasn't continued this turn (the unit was given another
    // order) is broken: its progress is lost.
    for (const u of s.units) {
      if (u.channel && !channelled.has(u.id)) {
        events.push({ type: 'channelBroken', unitId: u.id, kind: u.channel.kind, progress: u.channel.progress });
        u.channel = null;
      }
    }

    s.queue = carried;
    s.tick += 1;
    return events;
  }

  /**
   * Carry out a unit's attack in a direction (see the top of this file).
   * Returns a carried-over queue entry for a projectile still in flight, or
   * null.
   */
  performAttack(unit, dir, events, stepNo) {
    const atk = getUnitType(unit.type).attack;
    if (!atk) return null;
    if (atk.blockedByAdjacentEnemy) {
      const enemy = this.adjacentEnemy(unit);
      if (enemy) {
        events.push({ type: 'attackBlocked', step: stepNo, unitId: unit.id, reason: 'enemy adjacent', by: enemy.id });
        return null;
      }
    }
    if (atk.kind === AttackKind.PROJECTILE && atk.maxInFlight !== null) {
      const flying = this.projectilesOf(unit.id);
      if (flying.length >= atk.maxInFlight) {
        events.push({ type: 'attackBlocked', step: stepNo, unitId: unit.id, reason: 'projectile in flight', by: flying[0].id });
        return null;
      }
    }
    if (atk.kind === AttackKind.PROJECTILE) {
      const p = {
        id: this.state.nextProjectileId++, ownerId: unit.id, x: unit.x, y: unit.y,
        dir, speed: atk.speed, range: atk.range, traveled: 0,
      };
      this.state.projectiles.push(p);
      events.push({ type: 'shot', step: stepNo, unitId: unit.id, projectileId: p.id, dir, from: [p.x, p.y] });
      return this.fly(p, events, stepNo) ? { projectileId: p.id, carried: true } : null;
    }
    if (atk.kind === AttackKind.MELEE) {
      const cells = strikeCells(unit, dir, atk.reach).filter(([x, y]) => this.inBounds(x, y));
      events.push({ type: 'strike', step: stepNo, unitId: unit.id, dir, cells });
      for (const [x, y] of cells) {
        const victim = this.unitAt(x, y);
        if (victim) this.kill(victim, { cause: 'melee', sourceId: unit.id, attackerId: unit.id }, events, stepNo);
      }
    }
    return null;
  }

  /**
   * Walk a unit toward the order's target (at most its speed away; checked
   * when the order is given). Stops early at an occupied hex. Nothing
   * carries over: the move is over when its entry is.
   */
  walk(unit, order, events, stepNo) {
    const path = [[unit.x, unit.y]];
    let alive = true;
    for (let k = 0; k < unit.speed; k++) {
      if (unit.x === order.x && unit.y === order.y) break;
      const next = nextStep({ x: unit.x, y: unit.y, team: unit.team, order }, this.state);
      if (next.x === unit.x && next.y === unit.y) {
        events.push({ type: 'blocked', step: stepNo, unitId: unit.id, at: [unit.x, unit.y], reason: 'no route', by: null });
        break;
      }
      const occupant = this.unitAt(next.x, next.y);
      if (occupant) {
        events.push({ type: 'blocked', step: stepNo, unitId: unit.id, at: [unit.x, unit.y], reason: 'occupied', by: occupant.id });
        break;
      }
      const hazard = this.enterHex(unit, next.x, next.y);
      path.push([unit.x, unit.y]);
      if (hazard) {
        events.push({ type: 'moved', step: stepNo, unitId: unit.id, from: path[0], to: [unit.x, unit.y], path });
        this.setOff(unit, hazard, events, stepNo);
        alive = false;
        break;
      }
    }
    if (alive && path.length > 1) {
      events.push({ type: 'moved', step: stepNo, unitId: unit.id, from: path[0], to: path[path.length - 1], path });
    }
    if (alive && unit.x === order.x && unit.y === order.y) {
      events.push({ type: 'arrived', step: stepNo, unitId: unit.id, at: [unit.x, unit.y] });
    }
  }

  /**
   * Fly a projectile up to its speed. It hits the first unit it meets, is
   * stopped by the first building it meets (the building wins over a unit
   * standing on it), and is gone if it leaves the board or passes its range. Returns true if it
   * is still flying afterwards.
   */
  fly(p, events, stepNo) {
    const path = [[p.x, p.y]];
    let flying = true;
    for (let k = 0; k < p.speed; k++) {
      [p.x, p.y] = step(p.x, p.y, p.dir);
      p.traveled += 1;
      if (!this.inBounds(p.x, p.y) || (p.range !== null && p.traveled > p.range)) {
        events.push({ type: 'projectileExpired', step: stepNo, projectileId: p.id });
        this.removeProjectile(p);
        flying = false;
        break;
      }
      path.push([p.x, p.y]);
      const building = this.buildingAt(p.x, p.y);
      if (building) {
        // Buildings stop projectiles (anyone's); a unit standing there is safe.
        events.push({ type: 'projectileBlocked', step: stepNo, projectileId: p.id, at: [p.x, p.y], buildingId: building.id });
        this.removeProjectile(p);
        flying = false;
        break;
      }
      const victim = this.unitAt(p.x, p.y);
      if (victim) {
        this.removeProjectile(p);
        this.kill(victim, { cause: 'projectile', sourceId: p.id, attackerId: p.ownerId }, events, stepNo);
        flying = false;
        break;
      }
    }
    if (path.length > 1) events.push({ type: 'projectileMoved', step: stepNo, projectileId: p.id, path });
    return flying;
  }

  /** An enemy unit on one of the six hexes next to `unit` (first in direction order), or null. */
  adjacentEnemy(unit) {
    for (const [, x, y] of neighbors(unit.x, unit.y)) {
      const other = this.unitAt(x, y);
      if (other && other.team !== unit.team) return other;
    }
    return null;
  }

  /**
   * Put a unit on (x, y). Returns what it set off there, if anything: a
   * projectile in flight or a mine. (The caller reports the move first, then
   * calls setOff.)
   */
  enterHex(unit, x, y) {
    unit.x = x;
    unit.y = y;
    const p = this.projectileAt(x, y);
    if (p) return { kind: 'projectile', p };
    const m = this.mineAt(x, y);
    if (m) return { kind: 'mine', m };
    return null;
  }

  /** A unit set off a projectile or mine on its hex: it dies, and that's used up. */
  setOff(unit, hazard, events, stepNo) {
    if (hazard.kind === 'projectile') {
      this.removeProjectile(hazard.p);
      this.kill(unit, { cause: 'projectile', sourceId: hazard.p.id, attackerId: hazard.p.ownerId }, events, stepNo);
    } else {
      const m = hazard.m;
      this.state.mines = this.state.mines.filter((x) => x.id !== m.id);
      events.push({ type: 'mineExploded', step: stepNo, mineId: m.id, at: [m.x, m.y], unitId: unit.id });
      this.kill(unit, { cause: 'mine', sourceId: m.id, attackerId: m.ownerId }, events, stepNo);
    }
  }

  removeProjectile(p) {
    this.state.projectiles = this.state.projectiles.filter((q) => q.id !== p.id);
  }

  kill(unit, hit, events, stepNo) {
    events.push({
      type: 'killed', step: stepNo, unitId: unit.id, team: unit.team, at: [unit.x, unit.y], hits: [hit],
      // Shortcuts for projectile kills.
      by: hit.cause === 'projectile' ? [hit.sourceId] : [],
      shooterId: hit.cause === 'projectile' ? hit.attackerId : null,
    });
    this.state.units = this.state.units.filter((u) => u.id !== unit.id);
  }

  /** Stable hash of the full state; equal states always hash equal. */
  hash() {
    return hashState(this.state);
  }
}

/**
 * Where a charge in `dir` would go on the board as it stands: straight along
 * the hex line for up to the type's charge distance, stopping early before
 * an occupied hex (`reason: 'collided'`, `by`: that unit's id) or before
 * unwalkable terrain or the board edge (`reason: 'terrain'`); otherwise
 * `reason: 'full distance'`. Returns { path (including the start), end,
 * reason, by, strike } where `strike` is the hexes the closing attack will
 * hit if the unit's attack is melee (empty otherwise). Projectiles in flight
 * are not considered (running into one is resolved when the charge runs).
 */
export function chargePlan(game, unit, dir) {
  const def = getUnitType(unit.type);
  const path = [[unit.x, unit.y]];
  let [x, y] = [unit.x, unit.y];
  let reason = 'full distance';
  let by = null;
  for (let k = 0; k < (def.charge?.distance ?? 0); k++) {
    const [nx, ny] = step(x, y, dir);
    const occupant = game.unitAt?.(nx, ny) ?? null;
    if (occupant && occupant.id !== unit.id) {
      reason = 'collided';
      by = occupant.id;
      break;
    }
    if (!isWalkable(game.state ?? game, nx, ny, unit.team ?? null)) {
      reason = 'terrain';
      break;
    }
    [x, y] = [nx, ny];
    path.push([x, y]);
  }
  const end = { x, y };
  const strike = def.attack?.kind === AttackKind.MELEE
    ? strikeCells(end, dir, def.attack.reach).filter(([cx, cy]) => cx >= 0 && cy >= 0 && cx < game.width && cy < game.height)
    : [];
  return { path, end, reason, by, strike };
}

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

/**
 * The hex a unit wants to enter on its next step toward its move target.
 *
 * Units path around terrain they can't walk on (and the board's edges): the
 * step is always along a shortest walkable route. Among equally short
 * routes the straight hex line is preferred, then the direction order in
 * hex.js, so in open ground units walk straight lines. Other units are not
 * avoided: a blocked unit tries again on its next step. If the target can't
 * be reached at all, the unit stays put.
 *
 * @param {{x:number,y:number,order:object|null,team?:string}} unit (with a
 *   team, the other team's buildings are avoided)
 * @param {{width:number,height:number,terrain?:string[]}} [board] a Game or
 *   its state; omit for an unbounded, all-walkable plane
 */
export function nextStep(unit, board = null) {
  const o = unit.order;
  const stay = { x: unit.x, y: unit.y };
  if (!o || o.type !== OrderType.MOVE) return stay;
  if (o.x === unit.x && o.y === unit.y) return stay;
  const [lx, ly] = hexLineStep(unit.x, unit.y, o.x, o.y);
  if (!board) return { x: lx, y: ly };

  const dist = distancesTo(board, o.x, o.y, unit.team ?? null);
  const here = dist.get(`${unit.x},${unit.y}`);
  if (here === undefined) return stay; // unreachable
  if (dist.get(`${lx},${ly}`) === here - 1) return { x: lx, y: ly };
  for (const [, x, y] of neighbors(unit.x, unit.y)) {
    if (dist.get(`${x},${y}`) === here - 1) return { x, y };
  }
  return stay;
}

/**
 * The furthest hex a unit can reach this turn on its route toward (tx, ty):
 * up to `steps` (default its speed) hexes along the same route a move would
 * take. It stops short of the target if another unit stands on it. Other
 * units elsewhere are ignored. Returns [x, y] (its own hex if it can't get
 * any closer). For planners that want to head somewhere further than one
 * turn's walk.
 */
export function walkToward(board, unit, tx, ty, steps = unit.speed) {
  const order = { type: OrderType.MOVE, x: tx, y: ty };
  const occupied = (x, y) => board.units?.some((u) => u.id !== unit.id && u.x === x && u.y === y);
  let cur = { x: unit.x, y: unit.y, team: unit.team, order };
  for (let k = 0; k < steps; k++) {
    const next = nextStep(cur, board.state ?? board);
    if (next.x === cur.x && next.y === cur.y) break;
    if (next.x === tx && next.y === ty && occupied(tx, ty)) break;
    cur = { ...cur, x: next.x, y: next.y };
  }
  return [cur.x, cur.y];
}

/**
 * Is (x, y) on the board and walkable? Works on a Game or its state. With a
 * team, the other team's buildings count as unwalkable too (allies can walk
 * on or through their own side's buildings).
 */
export function isWalkable(board, x, y, team = null) {
  if (x < 0 || y < 0 || x >= board.width || y >= board.height) return false;
  const t = board.terrain?.[y * board.width + x];
  if (t !== undefined && !getTerrainType(t).walkable) return false;
  if (team !== null && board.buildings?.some((b) => b.x === x && b.y === y && b.team !== team)) return false;
  return true;
}

/**
 * Walking distance (hex steps over walkable terrain) from every hex that can
 * reach (tx, ty), as a Map "x,y" -> steps. Breadth-first search from the
 * target; units are ignored. With a team, the other team's buildings are
 * impassable. Empty if the target itself isn't walkable.
 */
export function distancesTo(board, tx, ty, team = null) {
  board = board.state ?? board;
  const dist = new Map();
  if (!isWalkable(board, tx, ty, team)) return dist;
  dist.set(`${tx},${ty}`, 0);
  const frontier = [[tx, ty]];
  for (let i = 0; i < frontier.length; i++) {
    const [cx, cy] = frontier[i];
    const d = dist.get(`${cx},${cy}`);
    for (const [, nx, ny] of neighbors(cx, cy)) {
      const k = `${nx},${ny}`;
      if (dist.has(k) || !isWalkable(board, nx, ny, team)) continue;
      dist.set(k, d + 1);
      frontier.push([nx, ny]);
    }
  }
  return dist;
}

/** Build the row-major terrain array from map rows (or all default). */
function parseTerrain(rows, width, height) {
  if (rows === null || rows === undefined) return Array(width * height).fill(Terrain.DEFAULT_TERRAIN);
  if (!Array.isArray(rows) || rows.length !== height) throw new Error(`Terrain must have ${height} rows`);
  const out = [];
  rows.forEach((row, y) => {
    const chars = [...row];
    if (chars.length !== width) throw new Error(`Terrain row ${y} must have ${width} characters`);
    for (const ch of chars) out.push(terrainForChar(ch));
  });
  return out;
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
