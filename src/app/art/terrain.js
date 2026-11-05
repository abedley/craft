// Terrain, trees, buildings, mines and the objective flag, in ink.
//
// Each function draws one thing at one hex using an IsoView for positions.
// `seed` keeps the hand-drawn wobble the same from frame to frame.

import { INK, PAPER, rng, seedOf, line, poly, hatch, stipple, ellipse, clipTo } from '../ink.js';
import { BASE, BUILDING_HEIGHT } from '../iso.js';

/** Line-width multiplier for the current zoom (1 at 30 px per hex radius). */
export const penOf = (view) => Math.max(0.75, Math.min(2.2, view.scale / 30));

/**
 * One hex as a prism: its three near side faces (hatched for shade, light
 * from the upper left) and its textured top face.
 */
export function drawTile(ctx, view, x, y, key, seed = 0) {
  const r = rng(seedOf('tile', x, y, seed));
  const k = penOf(view);
  const h = view.groundHeight(x, y);
  // Sides: left lit, right in shade.
  const gaps = { left: 5.5, right: 2.6 };
  for (const { side, pts } of view.sides(x, y, h)) {
    poly(ctx, pts, r, { fill: PAPER, width: 1.2 * k, amp: 0.5 });
    hatch(ctx, pts, r, { angle: Math.PI / 2, gap: gaps[side] * k, width: 0.8 * k, amp: 0.35 });
  }
  const top = view.face(x, y, h);
  poly(ctx, top, r, { fill: PAPER, width: 1.5 * k, amp: 0.6 });
  drawTexture(ctx, view, x, y, key, h, r, k);
}

function drawTexture(ctx, view, x, y, key, h, r, k) {
  const s = view.scale;
  const inner = view.face(x, y, h, 0.78);
  const spot = () => {
    // A random point on the top face, kept off the edges.
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 0.62;
    const [px, py] = view.plane(x, y);
    return view.project(px + Math.cos(a) * d, py + Math.sin(a) * d * 0.9, h);
  };
  switch (key) {
    case 'grass': {
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) tuft(ctx, ...spot(), s * 0.09, r, k);
      break;
    }
    case 'forest': {
      stipple(ctx, inner, r, { density: 0.5 / k, size: 0.7 * k });
      break;
    }
    case 'road': {
      // Cobbles.
      const n = 6 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const [cx, cy] = spot();
        ellipse(ctx, cx, cy, s * (0.1 + r() * 0.05), s * (0.05 + r() * 0.025), r, { width: 0.9 * k });
      }
      break;
    }
    case 'sand': {
      stipple(ctx, inner, r, { density: 1.5 / k, size: 0.65 * k });
      const [cx, cy] = spot();
      arc(ctx, cx, cy, s * 0.22, r, k);
      break;
    }
    case 'water': {
      hatch(ctx, view.face(x, y, h, 0.97), r, { angle: 0, gap: 3.4 * k, width: 0.7 * k, amp: 0.6 });
      clipTo(ctx, view.face(x, y, h, 0.96), () => {
        for (let i = 0; i < 3; i++) {
          const [cx, cy] = spot();
          wave(ctx, cx, cy, s * (0.28 + r() * 0.12), r, k);
        }
      });
      break;
    }
    default:
      stipple(ctx, inner, r, { density: 0.25 / k, size: 0.7 * k });
  }
}

/** A little "\|/" grass tuft standing on (x, y). */
export function tuft(ctx, x, y, size, r, k = 1) {
  ctx.lineCap = 'round';
  for (const a of [-0.5, 0, 0.5]) {
    const len = size * (0.7 + r() * 0.5);
    line(ctx, x + a * size * 0.3, y, x + a * size * 0.3 + Math.sin(a) * len, y - Math.cos(a) * len, r, { width: 0.9 * k, amp: 0.2 });
  }
}

function arc(ctx, x, y, w, r, k) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.9 * k;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x, y - w * (0.25 + r() * 0.15), x + w / 2, y);
  ctx.stroke();
}

function wave(ctx, x, y, w, r, k) {
  // A paper gap under the wave so it reads over the water's hatching.
  ctx.lineCap = 'round';
  wavePath(ctx, x, y, w, r);
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 4.5 * k;
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2 * k;
  ctx.stroke();
}

function wavePath(ctx, x, y, w, r) {
  ctx.beginPath();
  const n = 3;
  const amp = w * 0.09 * (0.8 + r() * 0.4);
  ctx.moveTo(x - w / 2, y);
  for (let i = 0; i < n; i++) {
    const x0 = x - w / 2 + (w / n) * i;
    ctx.quadraticCurveTo(x0 + w / n / 4, y - amp, x0 + w / n / 2, y);
    ctx.quadraticCurveTo(x0 + (3 * w) / n / 4, y + amp, x0 + w / n, y);
  }
}

/** Trees on a forest hex (drawn in depth order with the units). */
export function drawTrees(ctx, view, x, y, seed = 0) {
  const r = rng(seedOf('trees', x, y, seed));
  const k = penOf(view);
  const s = view.scale;
  const h = view.groundHeight(x, y);
  const [px, py] = view.plane(x, y);
  const spots = [[-0.32, -0.3], [0.34, -0.12], [-0.05, 0.36]]
    .slice(0, 2 + Math.floor(r() * 2))
    .map(([dx, dy]) => [dx + (r() - 0.5) * 0.15, dy + (r() - 0.5) * 0.15])
    .sort((a, b) => a[1] - b[1]);
  for (const [dx, dy] of spots) {
    const [bx, by] = view.project(px + dx, py + dy, h);
    tree(ctx, bx, by, s * (0.75 + r() * 0.2), r, k);
  }
}

/** One round-canopy tree whose trunk stands on (x, y), `size` px tall. */
export function tree(ctx, x, y, size, r, k = 1) {
  ellipse(ctx, x, y, size * 0.2, size * 0.07, r, { stroke: false, fill: INK });
  line(ctx, x, y, x, y - size * 0.45, r, { width: 1.8 * k, amp: 0.3 });
  const cy = y - size * 0.68;
  const rad = size * 0.3;
  const pts = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = rad * (0.85 + r() * 0.3);
    pts.push([x + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9]);
  }
  poly(ctx, pts, r, { fill: PAPER, width: 1.4 * k, amp: 0.6 });
  // Shade the lower right of the canopy.
  const shade = pts.filter((p, i) => i <= 5).concat([[x, cy]]);
  hatch(ctx, shade, r, { angle: -Math.PI / 4, gap: 2.6 * k, width: 0.8 * k, amp: 0.3 });
}

/**
 * A building on its hex: a hatched block with a doorway, a flat roof and a
 * team flag (paper for the player, ink for the CPU). `rise` (0..1) animates
 * it going up.
 */
export function drawBuilding(ctx, view, b, seed = 0, rise = 1) {
  const r = rng(seedOf('bld', b.id, seed));
  const k = penOf(view);
  const h0 = view.groundHeight(b.x, b.y);
  const h1 = h0 + BUILDING_HEIGHT * rise;
  const inset = 0.8;
  const cpu = b.team === 'cpu';
  const gaps = { left: cpu ? 2.2 : 5, right: cpu ? 1.4 : 2.4 };
  // The near side faces, inset to match the roof.
  view.sides(b.x, b.y, h1, h0, inset).forEach(({ side, pts: quad }) => {
    poly(ctx, quad, r, { fill: PAPER, width: 1.5 * k, amp: 0.5 });
    hatch(ctx, quad, r, { angle: Math.PI / 2, gap: gaps[side] * k, width: 0.8 * k, amp: 0.3 });
    if (side === 'left' && rise > 0.6) {
      // Doorway.
      const [fx, fy] = [(quad[2][0] + quad[3][0]) / 2, (quad[2][1] + quad[3][1]) / 2];
      const dw = view.scale * 0.13;
      const dh = (quad[3][1] - quad[0][1]) * 0.55;
      poly(ctx, [[fx - dw, fy], [fx - dw, fy - dh], [fx + dw, fy - dh], [fx + dw, fy]], r, { fill: INK, width: 1.2 * k, amp: 0.3 });
    }
  });
  const roof = view.face(b.x, b.y, h1, inset);
  poly(ctx, roof, r, { fill: PAPER, width: 1.7 * k, amp: 0.5 });
  poly(ctx, view.face(b.x, b.y, h1, inset * 0.72), r, { width: 0.9 * k, amp: 0.4 });
  if (rise >= 1) {
    const [rx, ry] = view.corner(b.x, b.y, 5, h1, inset * 0.55);
    flag(ctx, rx, ry, view.scale * 0.55, r, k, cpu);
  }
}

/** A pole with a pennant, base at (x, y). */
export function flag(ctx, x, y, size, r, k = 1, dark = false) {
  line(ctx, x, y, x, y - size, r, { width: 1.5 * k, amp: 0.2 });
  const top = y - size;
  const pts = [[x, top], [x + size * 0.55, top + size * 0.15], [x, top + size * 0.32]];
  poly(ctx, pts, r, { fill: dark ? INK : PAPER, width: 1.3 * k, amp: 0.3 });
}

/** The objective flag (escort target). */
export function drawObjectiveFlag(ctx, view, x, y, seed = 0) {
  const r = rng(seedOf('goal', x, y, seed));
  const k = penOf(view);
  const s = view.scale;
  const h = view.groundHeight(x, y);
  const [cx, cy] = view.center(x, y, h);
  const bx = cx + s * 0.3;
  const by = cy - s * 0.05;
  ellipse(ctx, bx, by, s * 0.12, s * 0.05, r, { fill: INK, stroke: false });
  line(ctx, bx, by, bx, by - s * 1.25, r, { width: 2 * k, amp: 0.2 });
  const top = by - s * 1.25;
  const pts = [[bx, top], [bx + s * 0.62, top + s * 0.1], [bx + s * 0.48, top + s * 0.26], [bx + s * 0.62, top + s * 0.42], [bx, top + s * 0.4]];
  poly(ctx, pts, r, { fill: PAPER, width: 1.5 * k, amp: 0.4 });
  hatch(ctx, pts, r, { angle: Math.PI / 4, gap: 3 * k, width: 0.8 * k });
}

/** A mine: a spiky disc on the ground (ink for CPU mines, paper for the player's). */
export function drawMine(ctx, view, m, seed = 0) {
  const r = rng(seedOf('mine', m.id, seed));
  const k = penOf(view);
  const s = view.scale;
  const [cx, cy] = view.center(m.x, m.y);
  const dark = m.team === 'cpu';
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    line(ctx, cx + Math.cos(a) * s * 0.12, cy + Math.sin(a) * s * 0.07, cx + Math.cos(a) * s * 0.24, cy + Math.sin(a) * s * 0.14, r, { width: 1.4 * k, amp: 0.2 });
  }
  ellipse(ctx, cx, cy, s * 0.16, s * 0.1, r, { fill: dark ? INK : PAPER, width: 1.5 * k });
  ellipse(ctx, cx, cy - s * 0.02, s * 0.04, s * 0.025, r, { fill: dark ? PAPER : INK, stroke: false });
}

/**
 * Scattered pebbles and grass strokes on the paper around the board, in
 * plane space between the board's edge and `pad` radii out.
 */
export function drawPaperDecor(ctx, view, seed = 0, pad = 2) {
  const r = rng(seedOf('decor', view.game.width, view.game.height, seed));
  const k = penOf(view);
  const s = view.scale;
  const b = view.planeBounds();
  const n = Math.round((b.x1 - b.x0 + b.y1 - b.y0) * 1.6);
  for (let i = 0; i < n; i++) {
    const px = b.x0 - pad + r() * (b.x1 - b.x0 + pad * 2);
    const py = b.y0 - pad + r() * (b.y1 - b.y0 + pad * 2);
    const inside = px > b.x0 - 0.3 && px < b.x1 + 0.3 && py > b.y0 - 0.2 && py < b.y1 + 0.6;
    if (inside) continue;
    const [sx, sy] = view.project(px, py, BASE);
    if (r() < 0.55) tuft(ctx, sx, sy, s * 0.12, r, k);
    else ellipse(ctx, sx, sy, s * (0.05 + r() * 0.06), s * (0.03 + r() * 0.03), r, { width: 1 * k, fill: r() < 0.3 ? INK : PAPER });
  }
}
