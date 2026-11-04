// Unit type registry, loaded from JSON (src/data/units.json).
//
// Adding a unit normally needs no code: add an entry to units.json. The
// engine, CPU, renderer and debug UI all read behaviour from the definition.
// Only a brand-new attack *kind* needs code.
//
// File format:
//
//   {
//     "default": "pikeman",            unit type used when none is given
//     "renamed": { "basic": "pikeman" }, old type keys -> current (old saves)
//     "units": {
//       "<key>": {
//         "name":   "Pikeman",          display name                  (required)
//         "speed":  1,                  cells per tick, 1..MAX_SPEED  (required)
//         "shape":  "circle",           circle | diamond | square | triangle
//                                       (default circle)
//         "attack": { ... }             omit for a unit that can't attack
//         "teleport": { "distance": 3, "leavesMine": true, "maxMines": 2, "uses": 2 }
//                                       optional: jump to any free walkable hex
//                                       up to `distance` away (ignores what's in
//                                       between); `leavesMine` drops a mine on
//                                       the hex it left; `maxMines`: it can't
//                                       teleport while it has that many mines
//                                       on the board; `uses` per match (leave
//                                       it out for unlimited). A normal-speed
//                                       order: it joins the end of the queue.
//         "build": { "turns": 2 }        optional: channel this many turns to
//                                       put a building on its own hex (allies
//                                       can walk on/through buildings; enemies
//                                       can't)
//         "charge": { "distance": 3, "uses": 1 }
//                                       optional: a move of up to `distance`
//                                       hexes that goes to the FRONT of the
//                                       queue; `uses` per unit per match
//       }
//     }
//   }
//
// Attack kinds (the unit holds still on the turn it attacks):
//
//   "melee"       strikes the `reach` cells in a row next to the unit at the
//                 end of the tick (t = 1), killing every unit there.
//                 { "kind": "melee", "reach": 2, "directions": "all" }
//
//   "projectile"  fires a projectile from the unit's cell at the start of the
//                 tick. It flies straight at `speed` cells per tick, never
//                 steers, and kills the first unit it meets. `range` (cells)
//                 is optional; leave it out for unlimited range.
//                 { "kind": "projectile", "speed": 4, "directions": "orthogonal",
//                   "range": 6 }
//
//   A projectile attack may set "maxInFlight": 1: the unit can't fire while
//   that many of its projectiles are still in flight (checked when the
//   attack's queue entry runs).
//
//   Any attack may also set "blockedByAdjacentEnemy": true: the attack fails
//   (nothing happens) if an enemy is on a neighbouring hex at the moment its
//   queue entry runs. Attacks already made are unaffected.
//
//   "directions" is "all" (the 6 hex directions), "vertical" (up/down), or a
//   list such as ["up", "down-left"]. Hex directions: up, up-right,
//   down-right, down, down-left, up-left.

import data from '../data/units.json' with { type: 'json' };
import { Directions, ALL_DIRECTIONS, OrderType } from './orders.js';

/** Fastest allowed speed (units and projectiles), in cells per tick. */
export const MAX_SPEED = 6;

export const AttackKind = Object.freeze({ MELEE: 'melee', PROJECTILE: 'projectile' });
export const SHAPES = Object.freeze(['circle', 'diamond', 'square', 'triangle']);

const DIRECTION_SETS = { all: ALL_DIRECTIONS, vertical: Object.freeze(['up', 'down']) };

/** Registered unit types by key. Entries are frozen, normalized definitions. */
export const UnitTypes = {};
export let DEFAULT_UNIT_TYPE = null;
export let RENAMED_TYPES = Object.freeze({});

export function getUnitType(type) {
  const def = UnitTypes[type];
  if (!def) throw new Error(`Unknown unit type "${type}"`);
  return def;
}

/**
 * Validate one raw JSON unit definition and return the normalized, frozen
 * definition the engine uses. Throws an Error naming the unit and field.
 */
export function defineUnitType(key, raw) {
  const fail = (msg) => { throw new Error(`Unit type "${key}": ${msg}`); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('must be an object');
  checkKeys(raw, ['name', 'speed', 'shape', 'attack', 'charge', 'teleport', 'build'], fail);

  if (typeof raw.name !== 'string' || !raw.name) fail('"name" must be a non-empty string');
  checkSpeed(raw.speed, '"speed"', fail);
  const shape = raw.shape ?? 'circle';
  if (!SHAPES.includes(shape)) fail(`"shape" must be one of ${SHAPES.join(', ')}`);

  let attack = null;
  if (raw.attack !== undefined) {
    const a = raw.attack;
    if (!a || typeof a !== 'object' || Array.isArray(a)) fail('"attack" must be an object');
    const directions = parseDirections(a.directions, fail);
    if (a.blockedByAdjacentEnemy !== undefined && typeof a.blockedByAdjacentEnemy !== 'boolean') {
      fail('"attack.blockedByAdjacentEnemy" must be true or false');
    }
    const blockedByAdjacentEnemy = a.blockedByAdjacentEnemy ?? false;
    switch (a.kind) {
      case AttackKind.MELEE:
        checkKeys(a, ['kind', 'reach', 'directions', 'blockedByAdjacentEnemy'], fail, 'attack.');
        if (!Number.isInteger(a.reach) || a.reach < 1) fail('"attack.reach" must be a positive integer');
        attack = { kind: a.kind, reach: a.reach, directions, blockedByAdjacentEnemy };
        break;
      case AttackKind.PROJECTILE:
        checkKeys(a, ['kind', 'speed', 'range', 'directions', 'blockedByAdjacentEnemy', 'maxInFlight'], fail, 'attack.');
        if (a.maxInFlight !== undefined && (!Number.isInteger(a.maxInFlight) || a.maxInFlight < 1)) {
          fail('"attack.maxInFlight" must be a positive integer (or left out for no limit)');
        }
        checkSpeed(a.speed, '"attack.speed"', fail);
        if (a.range !== undefined && (!Number.isInteger(a.range) || a.range < 1)) {
          fail('"attack.range" must be a positive integer (or left out for unlimited)');
        }
        attack = { kind: a.kind, speed: a.speed, range: a.range ?? null, directions, blockedByAdjacentEnemy, maxInFlight: a.maxInFlight ?? null };
        break;
      default:
        fail(`"attack.kind" must be one of ${Object.values(AttackKind).join(', ')}`);
    }
    Object.freeze(attack);
  }

  let charge = null;
  if (raw.charge !== undefined) {
    const c = raw.charge;
    if (!c || typeof c !== 'object' || Array.isArray(c)) fail('"charge" must be an object');
    checkKeys(c, ['distance', 'uses'], fail, 'charge.');
    checkSpeed(c.distance, '"charge.distance"', fail);
    if (!Number.isInteger(c.uses) || c.uses < 1) fail('"charge.uses" must be a positive integer');
    charge = Object.freeze({ distance: c.distance, uses: c.uses });
  }

  let teleport = null;
  if (raw.teleport !== undefined) {
    const t = raw.teleport;
    if (!t || typeof t !== 'object' || Array.isArray(t)) fail('"teleport" must be an object');
    checkKeys(t, ['distance', 'leavesMine', 'maxMines', 'uses'], fail, 'teleport.');
    if (t.maxMines !== undefined && (!Number.isInteger(t.maxMines) || t.maxMines < 1)) {
      fail('"teleport.maxMines" must be a positive integer (or left out for no limit)');
    }
    if (t.maxMines !== undefined && !t.leavesMine) fail('"teleport.maxMines" only makes sense with "leavesMine": true');
    checkSpeed(t.distance, '"teleport.distance"', fail);
    if (t.leavesMine !== undefined && typeof t.leavesMine !== 'boolean') fail('"teleport.leavesMine" must be true or false');
    if (t.uses !== undefined && (!Number.isInteger(t.uses) || t.uses < 1)) fail('"teleport.uses" must be a positive integer (or left out for unlimited)');
    teleport = Object.freeze({ distance: t.distance, leavesMine: t.leavesMine ?? false, maxMines: t.maxMines ?? null, uses: t.uses ?? null });
  }

  let build = null;
  if (raw.build !== undefined) {
    const b = raw.build;
    if (!b || typeof b !== 'object' || Array.isArray(b)) fail('"build" must be an object');
    checkKeys(b, ['turns'], fail, 'build.');
    if (!Number.isInteger(b.turns) || b.turns < 1) fail('"build.turns" must be a positive integer');
    build = Object.freeze({ turns: b.turns });
  }

  return Object.freeze({
    key,
    name: raw.name,
    speed: raw.speed,
    shape,
    attack,
    charge,
    teleport,
    build,
    orders: Object.freeze([
      OrderType.MOVE,
      ...(attack ? [OrderType.ATTACK] : []),
      ...(teleport ? [OrderType.TELEPORT] : []),
      ...(build ? [OrderType.BUILD] : []),
    ]),
  });
}

/**
 * Validate a whole units file (see the format above) and register its types,
 * replacing any with the same key. Validates everything before changing the
 * registry, so a bad file leaves the current types untouched.
 */
export function registerUnitTypes(json) {
  if (!json || typeof json !== 'object' || !json.units || typeof json.units !== 'object') {
    throw new Error('Units file must have a "units" object');
  }
  const defs = Object.entries(json.units).map(([key, raw]) => defineUnitType(key, raw));
  const known = new Set([...Object.keys(UnitTypes), ...defs.map((d) => d.key)]);
  const def = json.default ?? DEFAULT_UNIT_TYPE;
  if (!known.has(def)) throw new Error(`Default unit type "${def}" is not defined`);
  const renamed = json.renamed ?? {};
  for (const [from, to] of Object.entries(renamed)) {
    if (!known.has(to)) throw new Error(`Renamed type "${from}" points to undefined type "${to}"`);
  }

  for (const d of defs) UnitTypes[d.key] = d;
  DEFAULT_UNIT_TYPE = def;
  RENAMED_TYPES = Object.freeze({ ...RENAMED_TYPES, ...renamed });
}

function checkKeys(obj, allowed, fail, prefix = '') {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(`unknown field "${prefix}${k}" (allowed: ${allowed.join(', ')})`);
  }
}

function checkSpeed(v, label, fail) {
  if (!Number.isInteger(v) || v < 1 || v > MAX_SPEED) fail(`${label} must be an integer from 1 to ${MAX_SPEED}`);
}

function parseDirections(spec, fail) {
  if (typeof spec === 'string') {
    if (!DIRECTION_SETS[spec]) {
      fail(`"attack.directions" must be ${Object.keys(DIRECTION_SETS).join(', ')} or a list of hex directions (${ALL_DIRECTIONS.join(', ')})`);
    }
    return DIRECTION_SETS[spec];
  }
  if (Array.isArray(spec) && spec.length > 0) {
    for (const d of spec) {
      if (!Object.hasOwn(Directions, d)) fail(`unknown direction "${d}" (use ${ALL_DIRECTIONS.join(', ')})`);
    }
    // Keep a canonical order so behaviour doesn't depend on how the list is written.
    return Object.freeze(ALL_DIRECTIONS.filter((d) => spec.includes(d)));
  }
  return fail('"attack.directions" is required');
}

registerUnitTypes(data);
