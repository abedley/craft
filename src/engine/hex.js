// Hex grid geometry.
//
// The board is a rectangle of pointy-topped hexes (a corner points up and
// down) in "odd-r" layout: rows are straight horizontal lines and every odd
// row is shifted right by half a hex. Positions are stored as offset
// coordinates (x = column, y = row), which keeps the board rectangular and the
// state readable. Internally, geometry is done in axial coordinates (q, r),
// where the six directions are fixed vectors.
//
// Each hex has six neighbours: left, right, up-left, up-right, down-left and
// down-right (no straight up/down with pointy-topped hexes). Straight lines
// run through opposite sides: left/right, up-left/down-right,
// up-right/down-left.
//
// Everything here is integer arithmetic except hexLine's rounding, which
// uses fixed epsilon nudges so results are identical on every JS engine.

/** Axial (dq, dr) vector for each direction. */
export const Directions = Object.freeze({
  'up-left': Object.freeze([0, -1]),
  'up-right': Object.freeze([1, -1]),
  right: Object.freeze([1, 0]),
  'down-right': Object.freeze([0, 1]),
  'down-left': Object.freeze([-1, 1]),
  left: Object.freeze([-1, 0]),
});

export const ALL_DIRECTIONS = Object.freeze(Object.keys(Directions));

export const OPPOSITE = Object.freeze({
  left: 'right', right: 'left',
  'up-left': 'down-right', 'down-right': 'up-left',
  'up-right': 'down-left', 'down-left': 'up-right',
});

/** Screen angle (radians, y down) of each direction, for touch input and drawing. */
export const DIRECTION_ANGLES = Object.freeze({
  right: 0,
  'up-right': -Math.PI / 3,
  'up-left': (-2 * Math.PI) / 3,
  left: Math.PI,
  'down-left': (2 * Math.PI) / 3,
  'down-right': Math.PI / 3,
});

export function toAxial(x, y) {
  return [x - (y - (y & 1)) / 2, y];
}

export function fromAxial(q, r) {
  return [q + (r - (r & 1)) / 2, r];
}

/** The neighbouring cell in a direction (may be off the board). */
export function step(x, y, dir) {
  const [q, r] = toAxial(x, y);
  const [dq, dr] = Directions[dir];
  return fromAxial(q + dq, r + dr);
}

/** Number of steps between two cells. */
export function distance(ax, ay, bx, by) {
  const [aq, ar] = toAxial(ax, ay);
  const [bq, br] = toAxial(bx, by);
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** All six neighbours, in ALL_DIRECTIONS order, as [dir, x, y]. */
export function neighbors(x, y) {
  return ALL_DIRECTIONS.map((dir) => [dir, ...step(x, y, dir)]);
}

/**
 * The first cell on the straight-ish hex line from a to b (a itself if they
 * are equal). Uses the standard lerp-and-round line algorithm.
 */
export function hexLineStep(ax, ay, bx, by) {
  const n = distance(ax, ay, bx, by);
  if (n === 0) return [ax, ay];
  const [aq, ar] = toAxial(ax, ay);
  const [bq, br] = toAxial(bx, by);
  // Nudge off exact cell edges so ties always round the same way.
  const t = 1 / n;
  const q = aq + 1e-6 + (bq - aq) * t;
  const r = ar + 2e-6 + (br - ar) * t;
  return fromAxial(...axialRound(q, r));
}

/** Round fractional axial coordinates to the containing hex. */
export function axialRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}
