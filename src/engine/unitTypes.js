// Unit type registry. A unit's type defines how it moves and attacks.
//
//   speed       cells per tick when following a move order
//   orders      which order types the unit accepts
//   projectile  for shooters: what a shot fires
//                 speed       cells per tick (projectiles travel in a
//                             straight line, never steer, and fly until they
//                             hit a unit or leave the grid)
//                 directions  allowed firing directions
//   melee       for thrusters: the strike
//                 reach       how many cells in a row it hits
//                 directions  allowed strike directions

import { OrderType, ORTHOGONAL, ALL_DIRECTIONS } from './orders.js';

export const UnitTypes = Object.freeze({
  pikeman: Object.freeze({
    name: 'Pikeman',
    speed: 1,
    orders: Object.freeze([OrderType.MOVE, OrderType.THRUST]),
    melee: Object.freeze({ reach: 2, directions: ALL_DIRECTIONS }),
  }),
  gunslinger: Object.freeze({
    name: 'Gunslinger',
    speed: 1,
    orders: Object.freeze([OrderType.MOVE, OrderType.SHOOT]),
    projectile: Object.freeze({ speed: 4, directions: ORTHOGONAL }),
  }),
});

export const DEFAULT_UNIT_TYPE = 'pikeman';

/** Types that no longer exist, mapped to their replacement (for old saves). */
export const RENAMED_TYPES = Object.freeze({ basic: 'pikeman' });

export function getUnitType(type) {
  const def = UnitTypes[type];
  if (!def) throw new Error(`Unknown unit type "${type}"`);
  return def;
}
