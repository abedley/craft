// Unit type registry. A unit's type defines how it moves and attacks.
//
//   speed       cells per tick when following a move order
//   orders      which order types the unit accepts
//   projectile  for shooters: what a shot fires
//                 speed  cells per tick (projectiles travel in a straight
//                        line, never steer, and fly until they hit a unit or
//                        leave the grid)

import { OrderType } from './orders.js';

export const UnitTypes = Object.freeze({
  basic: Object.freeze({
    name: 'Basic',
    speed: 1,
    orders: Object.freeze([OrderType.MOVE]),
  }),
  gunslinger: Object.freeze({
    name: 'Gunslinger',
    speed: 1,
    orders: Object.freeze([OrderType.MOVE, OrderType.SHOOT]),
    projectile: Object.freeze({ speed: 4 }),
  }),
});

export const DEFAULT_UNIT_TYPE = 'basic';

export function getUnitType(type) {
  const def = UnitTypes[type];
  if (!def) throw new Error(`Unknown unit type "${type}"`);
  return def;
}
