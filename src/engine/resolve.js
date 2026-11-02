// Simultaneous movement resolution.
//
// Every unit declares the cell it wants to occupy after this tick (its
// "intent"; a unit that is not moving intends to stay put). All moves happen
// at the same time, so the outcome must not depend on the order in which we
// look at units. Rules, applied in this order:
//
//   1. Contested cell: when several units want to enter the same cell, the
//      unit with the lowest id wins; the others are blocked ("contested").
//   2. Swap: two units trying to trade cells pass through each other, which
//      is not allowed; both are blocked ("swap").
//   3. Occupied: a unit may enter a cell that is currently occupied only if
//      the occupant successfully leaves this tick. Otherwise it is blocked
//      ("occupied"). This is repeated until nothing changes, so a blocked
//      unit at the front of a line blocks the whole line behind it, while a
//      line that is free at the front moves together ("train").
//
// Closed loops of three or more units (A->B->C->A) all move: every cell is
// vacated and refilled in the same instant, with no two units passing
// through each other.
//
// The function is pure: it returns a result and does not mutate its input.

/**
 * @param {Array<{id:number,x:number,y:number,tx:number,ty:number}>} intents
 *   One entry per unit: current cell (x,y) and desired cell (tx,ty).
 * @returns {Map<number, {x:number,y:number,moved:boolean,blocked:null|{reason:string,by:number|null}}>}
 */
export function resolveMoves(intents) {
  const sorted = [...intents].sort((a, b) => a.id - b.id);
  const key = (x, y) => `${x},${y}`;

  const byId = new Map();
  const occupant = new Map(); // current cell -> unit id
  for (const it of sorted) {
    byId.set(it.id, it);
    occupant.set(key(it.x, it.y), it.id);
  }

  const isMover = (it) => it.tx !== it.x || it.ty !== it.y;
  const blocked = new Map(); // id -> { reason, by }
  const block = (id, reason, by) => {
    if (!blocked.has(id)) blocked.set(id, { reason, by });
  };

  // 1. Contested destinations: lowest id wins.
  const claims = new Map(); // dest cell -> first (lowest id) claimant
  for (const it of sorted) {
    if (!isMover(it)) continue;
    const k = key(it.tx, it.ty);
    if (claims.has(k)) block(it.id, 'contested', claims.get(k));
    else claims.set(k, it.id);
  }

  // 2. Head-on swaps.
  for (const it of sorted) {
    if (!isMover(it)) continue;
    const otherId = occupant.get(key(it.tx, it.ty));
    if (otherId === undefined) continue;
    const other = byId.get(otherId);
    if (isMover(other) && other.tx === it.x && other.ty === it.y) {
      block(it.id, 'swap', other.id);
    }
  }

  // 3. Occupied cells, propagated to a fixed point.
  let changed = true;
  while (changed) {
    changed = false;
    for (const it of sorted) {
      if (!isMover(it) || blocked.has(it.id)) continue;
      const otherId = occupant.get(key(it.tx, it.ty));
      if (otherId === undefined) continue;
      const other = byId.get(otherId);
      if (!isMover(other) || blocked.has(other.id)) {
        block(it.id, 'occupied', other.id);
        changed = true;
      }
    }
  }

  const result = new Map();
  for (const it of sorted) {
    const b = blocked.get(it.id) ?? null;
    const moves = isMover(it) && !b;
    result.set(it.id, {
      x: moves ? it.tx : it.x,
      y: moves ? it.ty : it.y,
      moved: moves,
      blocked: b,
    });
  }
  return result;
}
