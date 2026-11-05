// Hand-drawn human figures for each unit type.
//
// Player units are paper with an ink outline; CPU units are solid ink with
// paper details. Figures are drawn upward from their feet; `s` is the size
// of one hex radius in px (a figure is about 1.2 radii tall). Unknown types
// (added in units.json) get a generic figure wearing their shape as a badge.

import { INK, PAPER, rng, seedOf, line, poly, hatch, ellipse, star, stipple } from '../ink.js';

const FIGURES = { pikeman, gunslinger, stalker, builder };

/**
 * Draw a figure standing at (fx, fy).
 * @param {{type:string, team:string, shape?:string}} unit
 * @param {{seed?:number, face?:1|-1, alpha?:number}} [opts]
 */
export function drawFigure(ctx, unit, fx, fy, s, { seed = 0, face, shape = 'circle' } = {}) {
  const r = rng(seedOf('fig', unit.id ?? unit.type, seed));
  const cpu = unit.team === 'cpu';
  const f = face ?? (cpu ? -1 : 1);
  const k = Math.max(0.75, Math.min(2.6, s / 30));
  const P = (dx, dy) => [fx + dx * s * f, fy + dy * s];
  const fig = {
    P, s, k, r, f,
    fill: cpu ? INK : PAPER,
    detail: cpu ? PAPER : INK,
    w: 1.5 * k,
  };
  // Shadow.
  const shadow = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    shadow.push([fx + Math.cos(a) * s * 0.3, fy + Math.sin(a) * s * 0.11]);
  }
  stipple(ctx, shadow, r, { density: 6 / k, size: 0.55 * k });
  (FIGURES[unit.type] ?? generic(shape))(ctx, fig);
}

// ---- body parts -------------------------------------------------------------

function legs(ctx, { P, r, k }, spread = 0.1) {
  ctx.lineCap = 'round';
  line(ctx, ...P(-0.06, -0.42), ...P(-spread, 0), r, { width: 2.2 * k, amp: 0.2 });
  line(ctx, ...P(0.06, -0.42), ...P(spread + 0.02, 0), r, { width: 2.2 * k, amp: 0.2 });
}

function torso(ctx, { P, r, fill, w }, top = 0.8, bottom = 0.38, wTop = 0.15, wBottom = 0.12) {
  const pts = [P(-wTop, -top), P(wTop, -top), P(wBottom, -bottom), P(-wBottom, -bottom)];
  poly(ctx, pts, r, { fill, width: w, amp: 0.3 });
  return pts;
}

function head(ctx, { P, s, r, fill, w }, y = -0.93, rad = 0.11) {
  const [hx, hy] = P(0, y);
  ellipse(ctx, hx, hy, s * rad, s * rad * 1.05, r, { fill, width: w });
  return [hx, hy];
}

function arm(ctx, { P, r, k }, from, to) {
  ctx.lineCap = 'round';
  line(ctx, ...P(...from), ...P(...to), r, { width: 2 * k, amp: 0.2 });
}

// ---- unit types -------------------------------------------------------------

function pikeman(ctx, fig) {
  const { P, r, k, fill, detail, w, s } = fig;
  legs(ctx, fig);
  arm(ctx, fig, [-0.12, -0.76], [-0.2, -0.48]);
  torso(ctx, fig);
  // Tabard stripe.
  line(ctx, ...P(0, -0.76), ...P(0, -0.42), r, { width: 1.2 * k, amp: 0.2, color: detail });
  head(ctx, fig);
  // Kettle helmet: dome and a wide brim.
  const [hx, hy] = P(0, -0.98);
  ctx.fillStyle = fill;
  ctx.strokeStyle = INK;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.ellipse(hx, hy, s * 0.11, s * 0.09, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  line(ctx, ...P(-0.2, -0.97), ...P(0.2, -0.97), r, { width: 2 * k, amp: 0.2 });
  // The pike, held in front.
  line(ctx, ...P(0.24, 0.04), ...P(0.3, -1.5), r, { width: 1.8 * k, amp: 0.25 });
  poly(ctx, [P(0.31, -1.75), P(0.26, -1.5), P(0.35, -1.5)], r, { fill: INK, width: 1.2 * k, amp: 0.1 });
  arm(ctx, fig, [0.12, -0.76], [0.26, -0.62]);
}

function gunslinger(ctx, fig) {
  const { P, r, k, fill, detail, w } = fig;
  legs(ctx, fig);
  // Duster coat flaring out.
  const coat = [P(-0.15, -0.8), P(0.15, -0.8), P(0.2, -0.3), P(0.04, -0.34), P(-0.05, -0.3), P(-0.2, -0.3)];
  poly(ctx, coat, r, { fill, width: w, amp: 0.3 });
  line(ctx, ...P(-0.13, -0.56), ...P(0.15, -0.56), r, { width: 1.3 * k, amp: 0.2, color: detail }); // belt
  head(ctx, fig, -0.92);
  // Bandana.
  line(ctx, ...P(-0.08, -0.88), ...P(0.1, -0.88), r, { width: 2.2 * k, amp: 0.2 });
  // Wide-brim hat.
  const [bx, by] = P(0, -0.99);
  ellipse(ctx, bx, by, fig.s * 0.24, fig.s * 0.05, r, { fill, width: w });
  poly(ctx, [P(-0.1, -1.0), P(-0.08, -1.17), P(0.08, -1.17), P(0.1, -1.0)], r, { fill, width: w, amp: 0.2 });
  // Gun arm, aimed out.
  arm(ctx, fig, [0.12, -0.74], [0.36, -0.7]);
  poly(ctx, [P(0.33, -0.75), P(0.5, -0.75), P(0.5, -0.69), P(0.39, -0.69), P(0.38, -0.61), P(0.33, -0.61)], r, { fill: INK, width: 1.1 * k, amp: 0.1 });
  arm(ctx, fig, [-0.12, -0.74], [-0.18, -0.46]);
}

function stalker(ctx, fig) {
  const { P, r, k, fill, w, s } = fig;
  // Crouched under a long cloak.
  const cloak = [P(0.02, -0.82), P(0.17, -0.62), P(0.3, -0.04), P(0.12, 0), P(-0.08, -0.03), P(-0.3, 0), P(-0.16, -0.6)];
  poly(ctx, cloak, r, { fill, width: w, amp: 0.4 });
  if (fill === PAPER) hatch(ctx, cloak, r, { angle: -Math.PI / 3, gap: 3.2 * k, width: 0.8 * k, amp: 0.3 });
  // Hood with a dark opening and two paper eyes.
  const [hx, hy] = P(0.04, -0.76);
  ellipse(ctx, hx, hy, s * 0.15, s * 0.14, r, { fill, width: w });
  const [ox, oy] = P(0.08, -0.74);
  ellipse(ctx, ox, oy, s * 0.085, s * 0.075, r, { fill: INK, stroke: false });
  for (const dx of [0.05, 0.11]) {
    const [ex, ey] = P(dx, -0.75);
    ellipse(ctx, ex, ey, s * 0.018, s * 0.014, r, { fill: PAPER, stroke: false });
  }
  // A hand on the ground.
  arm(ctx, fig, [0.12, -0.5], [0.24, -0.06]);
}

function builder(ctx, fig) {
  const { P, r, k, fill, detail, w, s } = fig;
  // Crate beside them.
  const c = (dx, dy) => P(-0.3 + dx, dy);
  const front = [c(-0.12, 0), c(0.12, 0), c(0.12, -0.24), c(-0.12, -0.24)];
  poly(ctx, [c(-0.12, -0.24), c(0.12, -0.24), c(0.2, -0.32), c(-0.04, -0.32)], r, { fill: PAPER, width: 1.2 * k, amp: 0.2 });
  poly(ctx, [c(0.12, 0), c(0.2, -0.08), c(0.2, -0.32), c(0.12, -0.24)], r, { fill: INK, width: 1.2 * k, amp: 0.2 });
  poly(ctx, front, r, { fill: PAPER, width: 1.2 * k, amp: 0.2 });
  line(ctx, ...front[0], ...front[2], r, { width: 1 * k, amp: 0.2 });
  line(ctx, ...front[1], ...front[3], r, { width: 1 * k, amp: 0.2 });
  legs(ctx, fig);
  arm(ctx, fig, [-0.12, -0.75], [-0.22, -0.5]);
  torso(ctx, fig, 0.8, 0.38, 0.16, 0.14);
  // Overall straps.
  line(ctx, ...P(-0.08, -0.79), ...P(-0.05, -0.5), r, { width: 1.1 * k, amp: 0.1, color: detail });
  line(ctx, ...P(0.08, -0.79), ...P(0.05, -0.5), r, { width: 1.1 * k, amp: 0.1, color: detail });
  head(ctx, fig);
  // Hard hat.
  const [hx, hy] = P(0, -0.97);
  ctx.fillStyle = fill;
  ctx.strokeStyle = INK;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.ellipse(hx, hy, s * 0.12, s * 0.11, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  line(ctx, ...P(-0.16, -0.96), ...P(0.18, -0.96), r, { width: 2 * k, amp: 0.15 });
  line(ctx, ...P(0, -1.07), ...P(0, -0.98), r, { width: 1 * k, amp: 0.1, color: detail });
  // Hammer, raised.
  arm(ctx, fig, [0.12, -0.75], [0.26, -0.95]);
  line(ctx, ...P(0.22, -0.82), ...P(0.3, -1.16), r, { width: 1.6 * k, amp: 0.1 });
  poly(ctx, [P(0.2, -1.12), P(0.4, -1.18), P(0.42, -1.1), P(0.22, -1.04)], r, { fill: INK, width: 1 * k, amp: 0.1 });
}

/** Generic figure for unit types without their own drawing. */
function generic(shape) {
  return (ctx, fig) => {
    const { P, r, k, s, detail } = fig;
    legs(ctx, fig);
    arm(ctx, fig, [-0.12, -0.76], [-0.2, -0.48]);
    arm(ctx, fig, [0.12, -0.76], [0.2, -0.48]);
    torso(ctx, fig);
    head(ctx, fig);
    const [cx, cy] = P(0, -0.6);
    const b = s * 0.07;
    const badge = {
      circle: () => ellipse(ctx, cx, cy, b, b, r, { fill: detail, stroke: false }),
      diamond: () => poly(ctx, [[cx, cy - b], [cx + b, cy], [cx, cy + b], [cx - b, cy]], r, { fill: detail, width: k, color: detail }),
      square: () => poly(ctx, [[cx - b, cy - b], [cx + b, cy - b], [cx + b, cy + b], [cx - b, cy + b]], r, { fill: detail, width: k, color: detail }),
      triangle: () => poly(ctx, [[cx, cy - b], [cx + b, cy + b], [cx - b, cy + b]], r, { fill: detail, width: k, color: detail }),
    }[shape] ?? (() => {});
    badge();
  };
}

/** The star that marks the unit being escorted, centred at (x, y). */
export function escortStar(ctx, x, y, s, seed = 0) {
  star(ctx, x, y, s * 0.17, rng(seedOf('star', seed)));
}
