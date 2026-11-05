// The hand-drawn drawing kit: ink and pencil on paper.
//
// Everything wobbles a little so it looks inked by hand, but the wobble is
// seeded (rng(seed)) so a given line looks the same every frame. Shading is
// done with hatching and stipple patterns, never flat grey fills.

// Ink is a soft warm charcoal rather than black, for lower contrast; pencil
// is the light tone for background linework (terrain), so the pieces inked on
// top stand out.
export const INK = '#3a3631';
export const PENCIL = '#9a948a';
export const SHADE = '#77716a'; // between the two: edges of the terrain
export const PAPER = '#f4f1ea';

/** Small deterministic PRNG (mulberry32). rng(seed)() -> [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable integer seed from numbers / strings. */
export function seedOf(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const jitter = (r, amp) => (r() - 0.5) * 2 * amp;

/** Points along a straight line with a little perpendicular wobble. */
function wobblePoints(x1, y1, x2, y2, r, amp) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const n = Math.max(2, Math.round(len / 9));
  const nx = -(y2 - y1) / (len || 1);
  const ny = (x2 - x1) / (len || 1);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const w = i === 0 || i === n ? jitter(r, amp * 0.4) : jitter(r, amp);
    pts.push([x1 + (x2 - x1) * t + nx * w, y1 + (y2 - y1) * t + ny * w]);
  }
  return pts;
}

/** A hand-inked line. */
export function line(ctx, x1, y1, x2, y2, r, { amp = 0.7, width = 1.4, color = INK } = {}) {
  const pts = wobblePoints(x1, y1, x2, y2, r, amp);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.stroke();
}

/** Outline of a polygon with wobbly edges (optionally filled first). */
export function poly(ctx, pts, r, { fill = null, amp = 0.7, width = 1.5, stroke = true, color = INK } = {}) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }
  if (!stroke) return;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    line(ctx, x1, y1, x2, y2, r, { amp, width, color });
  }
}

/** Run fn with drawing clipped to a polygon. */
export function clipTo(ctx, pts, fn) {
  ctx.save();
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.clip();
  fn();
  ctx.restore();
}

function bbox(pts) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Parallel hatching inside a polygon, at `angle` radians, `gap` px apart. */
export function hatch(ctx, pts, r, { angle = Math.PI / 4, gap = 5, width = 1, amp = 0.5, color = INK } = {}) {
  const [x0, y0, x1, y1] = bbox(pts);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const reach = Math.hypot(x1 - x0, y1 - y0) / 2 + 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  clipTo(ctx, pts, () => {
    for (let o = -reach; o <= reach; o += gap) {
      const ox = cx - dy * o;
      const oy = cy + dx * o;
      line(ctx, ox - dx * reach, oy - dy * reach, ox + dx * reach, oy + dy * reach, r, { amp, width, color });
    }
  });
}

/** Scattered dots inside a polygon (`density` dots per 100 px²). */
export function stipple(ctx, pts, r, { density = 1.2, size = 0.9, color = INK } = {}) {
  const [x0, y0, x1, y1] = bbox(pts);
  const n = Math.round(((x1 - x0) * (y1 - y0) * density) / 100);
  clipTo(ctx, pts, () => {
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x = x0 + r() * (x1 - x0);
      const y = y0 + r() * (y1 - y0);
      ctx.beginPath();
      ctx.arc(x, y, size * (0.6 + r() * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Wobbly ellipse outline (and optional fill). */
export function ellipse(ctx, cx, cy, rx, ry, r, { fill = null, width = 1.4, stroke = true, color = INK } = {}) {
  const n = 18;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + jitter(r, 0.05);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  if (fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
  }
  return pts;
}

/** A dotted / dashed path through points, optionally ending in an arrowhead. */
export function dashedPath(ctx, pts, { dash = [5, 5], width = 2, arrow = false, color = INK } = {}) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(...pts[0]);
  for (const p of pts.slice(1)) ctx.lineTo(...p);
  ctx.stroke();
  ctx.setLineDash([]);
  if (arrow) arrowHead(ctx, pts[pts.length - 2], pts[pts.length - 1], { size: width * 4 + 4, color });
  ctx.restore();
}

/** A filled arrowhead at `to`, pointing from `from`. */
export function arrowHead(ctx, from, to, { size = 10, color = INK } = {}) {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - Math.cos(a - 0.45) * size, to[1] - Math.sin(a - 0.45) * size);
  ctx.lineTo(to[0] - Math.cos(a + 0.45) * size, to[1] - Math.sin(a + 0.45) * size);
  ctx.closePath();
  ctx.fill();
}

/** Target marker as in the reference art: corner brackets around an X. */
export function crosshair(ctx, x, y, s, r, { width = 2, color = INK } = {}) {
  const k = s * 0.35;
  ctx.lineCap = 'round';
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    line(ctx, x + sx * s, y + sy * s * 0.6, x + sx * (s - k), y + sy * s * 0.6, r, { width, amp: 0.4, color });
    line(ctx, x + sx * s, y + sy * s * 0.6, x + sx * s, y + sy * (s * 0.6 - k * 0.6), r, { width, amp: 0.4, color });
  }
  line(ctx, x - s * 0.35, y - s * 0.22, x + s * 0.35, y + s * 0.22, r, { width: width * 1.1, amp: 0.3, color });
  line(ctx, x + s * 0.35, y - s * 0.22, x - s * 0.35, y + s * 0.22, r, { width: width * 1.1, amp: 0.3, color });
}

/** Scribbled burst (explosions, hits). */
export function burst(ctx, x, y, s, r, { spikes = 9, color = INK } = {}) {
  ctx.lineCap = 'round';
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 + jitter(r, 0.2);
    const r0 = s * (0.25 + r() * 0.15);
    const r1 = s * (0.8 + r() * 0.4);
    line(ctx, x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.7, x + Math.cos(a) * r1, y + Math.sin(a) * r1 * 0.7, r, { width: 2, amp: 0.8, color });
  }
}

/** A small hand-drawn star (marks the escorted unit). */
export function star(ctx, cx, cy, rad, r, { fill = PAPER } = {}) {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (Math.PI / 5) * k;
    const rr = (k % 2 === 0 ? rad : rad * 0.45) * (1 + jitter(r, 0.06));
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  poly(ctx, pts, r, { fill, width: 1.6, amp: 0.3 });
}
