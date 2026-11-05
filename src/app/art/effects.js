// Markers drawn over the board: reach, selection, order intents (what each
// queue entry is going to do), danger marks and turn-playback effects.
//
// CPU intents are heavy dashed ink; the player's are lighter dotted lines
// with hollow arrowheads, so both read in 1-bit.

import { INK, PAPER, rng, seedOf, line, poly, hatch, ellipse, crosshair, burst } from '../ink.js';
import { penOf } from './terrain.js';
import { chargePlan, getUnitType } from '../../engine/index.js';
import { step as stepOf } from '../../engine/hex.js';
import { movePath, rayCells } from '../shared.js';

export const FONT = '"Patrick Hand", "Marker Felt", "Chalkboard SE", "Comic Sans MS", cursive';

const styleOf = (team, k) => (team === 'cpu'
  ? { width: 2.6 * k, dash: [7 * k, 4 * k], dark: true }
  : { width: 2 * k, dash: [0.5, 5 * k], dark: false });

/** Dotted outlines on hexes a selected unit can move or teleport to. */
export function reachMarks(ctx, view, cells, { teleport = false, seed = 0 } = {}) {
  const k = penOf(view);
  for (const [x, y] of cells) {
    const r = rng(seedOf('reach', x, y, seed));
    const pts = view.face(x, y, view.standHeight(x, y), 0.74);
    ctx.save();
    ctx.setLineDash(teleport ? [1, 4 * k] : [5 * k, 4 * k]);
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.8 * k;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    if (teleport) {
      const [cx, cy] = view.center(x, y, view.standHeight(x, y));
      const d = view.scale * 0.08;
      poly(ctx, [[cx, cy - d], [cx + d * 1.3, cy], [cx, cy + d], [cx - d * 1.3, cy]], r, { fill: INK, width: k, amp: 0.1 });
    }
  }
}

/** Corner brackets around the selected unit's hex. */
export function selectBrackets(ctx, view, x, y, seed = 0) {
  const r = rng(seedOf('sel', x, y, seed));
  const k = penOf(view);
  const h = view.standHeight(x, y);
  const pts = view.face(x, y, h, 1.02);
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % 6];
    const [cx, cy] = pts[(i + 5) % 6];
    line(ctx, ax, ay, ax + (bx - ax) * 0.3, ay + (by - ay) * 0.3, r, { width: 3 * k, amp: 0.3 });
    line(ctx, ax, ay, ax + (cx - ax) * 0.3, ay + (cy - ay) * 0.3, r, { width: 3 * k, amp: 0.3 });
  }
}

/** Ring on a target hex. */
function targetRing(ctx, view, x, y, r, k, dark) {
  const [cx, cy] = view.center(x, y, view.standHeight(x, y));
  ellipse(ctx, cx, cy, view.scale * 0.36, view.scale * 0.2, r, { width: (dark ? 2.4 : 1.8) * k });
}

function dashed(ctx, pts, { width, dash }) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(...pts[0]);
  for (const p of pts.slice(1)) ctx.lineTo(...p);
  ctx.stroke();
  ctx.restore();
}

/** A filled (CPU) or hollow (player) arrowhead at `to`. */
export function head(ctx, from, to, size, dark, k = 1) {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - Math.cos(a - 0.5) * size, to[1] - Math.sin(a - 0.5) * size);
  ctx.lineTo(to[0] - Math.cos(a + 0.5) * size, to[1] - Math.sin(a + 0.5) * size);
  ctx.closePath();
  ctx.fillStyle = dark ? INK : PAPER;
  ctx.fill();
  ctx.lineWidth = 1.5 * k;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** A path through hex centres (at stand height), with an arrowhead. */
function arrowPath(ctx, view, cells, style, k, { lift = 0 } = {}) {
  if (cells.length < 2) return;
  const pts = cells.map(([x, y]) => {
    const [sx, sy] = view.center(x, y, view.standHeight(x, y));
    return [sx, sy - lift];
  });
  // Stop short of the last centre so the head sits on the hex.
  const [ax, ay] = pts[pts.length - 2];
  const [bx, by] = pts[pts.length - 1];
  const end = [ax + (bx - ax) * 0.78, ay + (by - ay) * 0.78];
  dashed(ctx, [...pts.slice(0, -1), end], style);
  head(ctx, pts[pts.length - 2], end, 9 * k + 3, style.dark, k);
}

/**
 * What one queue entry is going to do, drawn from the board as it is now.
 * Returns the screen point its number badge goes at (or null).
 */
export function drawIntent(ctx, view, game, entry, { seed = 0 } = {}) {
  const k = penOf(view);
  const r = rng(seedOf('intent', entry.unitId ?? `p${entry.projectileId}`, seed));
  if (entry.projectileId !== undefined) {
    const p = game.getProjectile(entry.projectileId);
    if (!p) return null;
    const owner = game.getUnit(p.ownerId);
    const style = styleOf(owner?.team ?? 'cpu', k);
    shotRay(ctx, view, game, p.x, p.y, p.dir, p.speed, style, r, k);
    const [bx, by] = view.center(p.x, p.y, view.groundHeight(p.x, p.y) + 0.9);
    return [bx, by - view.scale * 0.2];
  }
  const u = game.getUnit(entry.unitId);
  if (!u) return null;
  const { order } = entry;
  const def = getUnitType(u.type);
  const style = styleOf(u.team, k);
  switch (order.type) {
    case 'move': {
      const path = movePath(game, u, order.x, order.y);
      arrowPath(ctx, view, path, style, k);
      targetRing(ctx, view, order.x, order.y, r, k, style.dark);
      break;
    }
    case 'attack':
      if (def.attack?.kind === 'projectile') {
        shotRay(ctx, view, game, u.x, u.y, order.dir, def.attack.speed, style, r, k);
      } else if (def.attack) {
        strikeMarks(ctx, view, game, u, order.dir, def.attack.reach, style, r, k);
      }
      break;
    case 'charge': {
      const plan = chargePlan(game, u, order.dir);
      arrowPath(ctx, view, plan.path, { ...style, width: style.width * 1.3 }, k);
      for (const [x, y] of plan.strike) {
        const [cx, cy] = view.center(x, y, view.standHeight(x, y));
        crosshair(ctx, cx, cy, view.scale * 0.42, r, { width: style.dark ? 2.4 * k : 1.7 * k });
      }
      break;
    }
    case 'teleport': {
      const [ax, ay] = view.center(u.x, u.y, view.standHeight(u.x, u.y));
      const [bx, by] = view.center(order.x, order.y, view.standHeight(order.x, order.y));
      const mx = (ax + bx) / 2;
      const my = Math.min(ay, by) - view.scale * 0.9;
      ctx.save();
      ctx.strokeStyle = INK;
      ctx.lineWidth = style.width;
      ctx.setLineDash(style.dash);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, my, bx, by);
      ctx.stroke();
      ctx.restore();
      head(ctx, [mx, my], [bx, by], 9 * k + 3, style.dark, k);
      targetRing(ctx, view, order.x, order.y, r, k, style.dark);
      break;
    }
    case 'build': {
      // Dashed outline of the building to come.
      const h0 = view.groundHeight(u.x, u.y);
      const roof = view.face(u.x, u.y, h0 + 0.85, 0.8);
      ctx.save();
      ctx.setLineDash([4 * k, 4 * k]);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6 * k;
      ctx.beginPath();
      roof.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      for (const c of [0, 1, 2, 3]) {
        const top = view.corner(u.x, u.y, c, h0 + 0.85, 0.8);
        const bot = view.corner(u.x, u.y, c, h0, 0.8);
        ctx.moveTo(...top);
        ctx.lineTo(...bot);
      }
      ctx.stroke();
      ctx.restore();
      break;
    }
    default:
  }
  const [ux, uy] = view.center(u.x, u.y, view.standHeight(u.x, u.y));
  return [ux + view.scale * 0.42, uy - view.scale * 1.15];
}

function shotRay(ctx, view, game, x, y, dir, speed, style, r, k) {
  const all = rayCells(game, x, y, dir);
  if (!all.length) return;
  const now = all.slice(0, speed);
  const later = all.slice(speed);
  const lift = view.scale * 0.55; // shots fly at chest height
  const pt = ([cx, cy]) => {
    const [sx, sy] = view.center(cx, cy, view.groundHeight(cx, cy));
    return [sx, sy - lift];
  };
  const start = pt([x, y]);
  const pts = [start, ...now.map(pt)];
  dashed(ctx, pts, { width: style.width, dash: style.dark ? [2, 4 * k] : [0.5, 4 * k] });
  head(ctx, pts[pts.length - 2], pts[pts.length - 1], 8 * k + 3, style.dark, k);
  if (later.length) {
    // Where it goes after this turn: faint dots.
    dashed(ctx, [pts[pts.length - 1], ...later.map(pt)], { width: 1 * k, dash: [0.5, 7 * k] });
  }
  // Mark the first unit or building in the shot's way.
  for (const [cx, cy] of all) {
    if (game.unitAt(cx, cy) || game.buildingAt(cx, cy)) {
      const [sx, sy] = view.center(cx, cy, view.standHeight(cx, cy));
      crosshair(ctx, sx, sy, view.scale * 0.42, r, { width: style.dark ? 2.4 * k : 1.7 * k });
      break;
    }
  }
}

function strikeMarks(ctx, view, game, u, dir, reach, style, r, k) {
  let [x, y] = [u.x, u.y];
  const cells = [];
  for (let i = 0; i < reach; i++) {
    [x, y] = stepOf(x, y, dir);
    if (!game.inBounds(x, y)) break;
    cells.push([x, y]);
  }
  if (cells.length) {
    const path = [[u.x, u.y], cells[0]];
    arrowPath(ctx, view, path, style, k);
  }
  for (const [cx, cy] of cells) {
    const [sx, sy] = view.center(cx, cy, view.standHeight(cx, cy));
    crosshair(ctx, sx, sy, view.scale * 0.42, r, { width: style.dark ? 2.4 * k : 1.7 * k });
  }
}

/** A queue number badge: ink disc for the CPU, paper for the player; fast entries get a double ring. */
export function badge(ctx, x, y, n, { dark, fast = false, active = false, k = 1 }) {
  const rad = 8.5 * Math.min(1.3, Math.max(0.9, k));
  ctx.save();
  if (active) {
    ctx.beginPath();
    ctx.arc(x, y, rad + 5, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, rad + 3, 0, Math.PI * 2);
    ctx.fillStyle = PAPER;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fillStyle = dark ? INK : PAPER;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (fast) {
    ctx.beginPath();
    ctx.arc(x, y, rad + 2.5, 0, Math.PI * 2);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.fillStyle = dark ? PAPER : INK;
  ctx.font = `${Math.round(rad * 1.5)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + 1);
  ctx.restore();
}

/** Danger: a unit that dies if the turn runs now. */
export function dangerMark(ctx, x, y, s, seed = 0) {
  const r = rng(seedOf('danger', seed));
  const k = Math.max(0.8, s / 30);
  ellipse(ctx, x, y, s * 0.22, s * 0.22, r, { fill: PAPER, width: 2 * k });
  line(ctx, x - s * 0.11, y - s * 0.11, x + s * 0.11, y + s * 0.11, r, { width: 2.6 * k, amp: 0.2 });
  line(ctx, x + s * 0.11, y - s * 0.11, x - s * 0.11, y + s * 0.11, r, { width: 2.6 * k, amp: 0.2 });
}

/** A projectile in flight: a slug with speed lines behind it. */
export function bullet(ctx, x, y, angle, s, seed = 0) {
  const r = rng(seedOf('bullet', seed));
  const k = Math.max(0.8, s / 30);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (const o of [-0.08, 0, 0.08]) {
    const ox = -dy * o * s;
    const oy = dx * o * s;
    line(ctx, x - dx * s * 0.2 + ox, y - dy * s * 0.2 + oy, x - dx * s * (0.45 + r() * 0.15) + ox, y - dy * s * (0.45 + r() * 0.15) + oy, r, { width: 1.1 * k, amp: 0.2 });
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.13, s * 0.07, 0, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.restore();
}

/** Hatched flash over struck hexes. */
export function strikeFlash(ctx, view, cells, t, seed = 0) {
  const r = rng(seedOf('flash', seed));
  const k = penOf(view);
  for (const [x, y] of cells) {
    const face = view.face(x, y, view.standHeight(x, y), 0.9);
    hatch(ctx, face, r, { angle: Math.PI / 4, gap: 3 * k, width: 1.2 * k });
    if (t < 0.6) hatch(ctx, face, r, { angle: -Math.PI / 4, gap: 3 * k, width: 1.2 * k });
  }
}

/** Explosion / hit burst. */
export function boom(ctx, x, y, s, t, seed = 0) {
  const r = rng(seedOf('boom', seed));
  burst(ctx, x, y, s * (0.5 + t * 0.7), r, { spikes: 11 });
  if (t < 0.5) ellipse(ctx, x, y, s * 0.2, s * 0.14, r, { fill: INK, stroke: false });
}

/** Hand-lettered text with a paper halo. */
export function label(ctx, x, y, text, size = 16, { dark = false } = {}) {
  ctx.save();
  ctx.font = `${Math.round(size)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (dark) {
    const w = ctx.measureText(text).width;
    ctx.fillStyle = INK;
    ctx.fillRect(x - w / 2 - 5, y - size * 0.62, w + 10, size * 1.2);
    ctx.fillStyle = PAPER;
  } else {
    ctx.lineWidth = 5;
    ctx.strokeStyle = PAPER;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = INK;
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Six arrows around a unit for picking an attack / charge direction. */
export function aimArrows(ctx, view, u, dirs, seed = 0) {
  const k = penOf(view);
  const [ux, uy] = view.center(u.x, u.y, view.standHeight(u.x, u.y));
  for (const dir of dirs) {
    const [nx, ny] = stepOf(u.x, u.y, dir);
    const [tx, ty] = view.center(nx, ny, view.standHeight(u.x, u.y));
    const a = [ux + (tx - ux) * 0.42, uy + (ty - uy) * 0.42];
    const b = [ux + (tx - ux) * 0.8, uy + (ty - uy) * 0.8];
    const r = rng(seedOf('aim', dir, seed));
    line(ctx, ...a, ...b, r, { width: 2.4 * k, amp: 0.3 });
    head(ctx, a, b, 9 * k + 2, false, k);
  }
}
