// Everything drawn on the pixel board: terrain tiles, trees, buildings,
// mines, the goal flag, units, order intents, markers and playback effects.
// All drawing goes through a Raster on the art buffer, in art pixels.

import { W, H, BASE, BOTTOM_ROW, OUTLINE, RING, insetOutline, BUILDING_HEIGHT } from './grid.js';
import { LIGHT, DARK, PAT, textWidth } from './raster.js';
import { UNITS, TREE, MINE, STAR, DIES, GOAL_FLAG, BULLET, FOOT_ROW, spriteCanvas, unitSprite } from './sprites.js';
import { chargePlan, getUnitType, DIRECTION_ANGLES } from '../../engine/index.js';
import { step } from '../../engine/hex.js';
import { movePath, rayCells } from '../shared.js';

const INSET2 = insetOutline(2);
const INSET4 = insetOutline(4);
const CHEST = 9; // shots fly this many px above the ground

/** Small seeded PRNG so a hex's texture is the same every time. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- terrain ----------------------------------------------------------------

/** Every hex, back to front: dithered prism sides, then the textured top. */
export function drawTerrain(r, v) {
  for (const [x, y] of v.drawOrder()) drawTile(r, v, x, y);
}

export function drawTile(r, v, x, y) {
  const g = v.game;
  const key = g.terrainAt(x, y);
  const h = v.groundHeight(x, y);
  const [ox, oy] = v.origin(x, y, h);
  const depth = h + BASE;
  // Sides: left lit (sparse dither), right in shade (heavy dither).
  for (let c = 0; c < W; c++) {
    const y0 = oy + BOTTOM_ROW[c] + 1;
    for (let d = 0; d < depth; d++) {
      const px = ox + c;
      const py = y0 + d;
      let col;
      if (d === depth - 1) col = DARK;
      else if (c < W / 2) col = PAT.sparse(px, py) ? DARK : LIGHT;
      else col = PAT.half(px, py) || PAT.quarter(px, py) ? DARK : LIGHT;
      r.px(px, py, col);
    }
  }
  r.face(ox, oy, LIGHT);
  const rand = rng((x * 73856093) ^ (y * 19349663) ^ key.length);
  const spot = (m = 4) => [ox + 4 + Math.floor(rand() * (W - 8)), oy + m + Math.floor(rand() * (H - m * 2))];
  switch (key) {
    case 'water': {
      r.face(ox, oy, DARK, (px, py) => py % 3 === 0 && (px + Math.floor(py / 3)) % 4 !== 0, 1);
      for (let i = 0; i < 2; i++) {
        const [wx, wy] = spot(5);
        r.px(wx, wy, DARK); r.px(wx + 1, wy - 1, DARK); r.px(wx + 2, wy - 1, DARK); r.px(wx + 3, wy, DARK);
      }
      break;
    }
    case 'grass':
    case 'forest': {
      const n = key === 'forest' ? 3 : Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const [tx, ty] = spot();
        r.px(tx, ty, DARK); r.px(tx + 2, ty, DARK); r.px(tx + 1, ty + 1, DARK);
      }
      break;
    }
    case 'road': {
      for (let i = 0; i < 4; i++) {
        const [cx, cy] = spot(4);
        r.px(cx, cy, DARK); r.px(cx + 1, cy, DARK);
      }
      break;
    }
    case 'sand': {
      for (let i = 0; i < 7; i++) {
        const [sx, sy] = spot(3);
        r.px(sx, sy, DARK);
      }
      break;
    }
    default:
      for (let i = 0; i < 3; i++) r.px(...spot(), DARK);
  }
  // Outline: every hex draws its top edges; right and bottom edges only at
  // the board's edge or above lower ground, so shared edges are 1px.
  r.pixels(OUTLINE.top, ox, oy, DARK);
  const lowerOrEdge = (nx, ny) => !v.inBounds(nx, ny) || v.groundHeight(nx, ny) < h;
  if (lowerOrEdge(...step(x, y, 'right'))) r.pixels(OUTLINE.right, ox, oy, DARK);
  if (lowerOrEdge(...step(x, y, 'down-left')) || lowerOrEdge(...step(x, y, 'down-right'))) r.pixels(OUTLINE.bottom, ox, oy, DARK);
}

// ---- things on the board -------------------------------------------------------

export function drawTrees(r, v, x, y) {
  const [cx, cy] = v.center(x, y);
  const rand = rng(x * 31 + y * 17);
  const spots = [[-6, -3], [5, -1], [-1, 4]].slice(0, 2 + Math.floor(rand() * 2));
  const tree = spriteCanvas(TREE, { key: 'tree' });
  for (const [dx, dy] of spots) r.blit(tree, cx + dx - 5, cy + dy - 10);
}

/** A building: a block with a flat roof and a team flag; `rise` 0..1 animates it going up. */
export function drawBuilding(r, v, b, rise = 1) {
  const cpu = b.team === 'cpu';
  const [cx, gy] = v.center(b.x, b.y);
  const hh = Math.round(BUILDING_HEIGHT * rise);
  const ry = gy - hh;
  const half = 9;
  // Walls, column by column: left face from L to B, right face from B to R.
  for (let dx = -half; dx <= half; dx++) {
    const yTop = ry + 4 - Math.round((Math.abs(dx) * 4) / half); // the roof's lower edge
    for (let d = 0; d <= hh; d++) {
      const px = cx + dx;
      const py = yTop + d;
      let col;
      if (dx === -half || dx === half || dx === 0 || d === hh) col = DARK;
      else if (dx < 0) col = cpu ? (PAT.sparse(px, py) ? LIGHT : DARK) : (PAT.sparse(px, py) ? DARK : LIGHT);
      else col = cpu ? DARK : (PAT.half(px, py) ? DARK : LIGHT);
      r.px(px, py, col);
    }
  }
  // Doorway on the lit face.
  if (rise > 0.6) {
    for (let i = 0; i < 3; i++) {
      const dx = -6 + i;
      const bottom = ry + 4 - Math.round((Math.abs(dx) * 4) / half) + hh - 1;
      for (let j = 0; j < 5; j++) r.px(cx + dx, bottom - j, cpu ? LIGHT : DARK);
    }
  }
  // Roof: a flat diamond.
  for (let dx = -half; dx <= half; dx++) {
    const span = 4 - Math.round((Math.abs(dx) * 4) / half);
    for (let dy = -span; dy <= span; dy++) {
      const edge = Math.abs(dy) === span || Math.abs(dx) === half;
      const px = cx + dx;
      const py = ry + dy;
      r.px(px, py, edge ? DARK : cpu ? (PAT.quarter(px, py) ? LIGHT : DARK) : LIGHT);
    }
  }
  if (rise >= 1) {
    // Team flag on the back corner.
    const fx = cx;
    const fy = ry - 4;
    r.line(fx, fy, fx, fy - 7, DARK);
    for (let j = 0; j < 3; j++) for (let i = 1; i <= 4 - j; i++) r.px(fx + i, fy - 7 + j, cpu ? DARK : LIGHT);
    r.line(fx + 1, fy - 8, fx + 5, fy - 8, DARK);
    r.line(fx + 5, fy - 7, fx + 1, fy - 4, DARK);
  }
}

export function drawMine(r, v, m) {
  const [cx, cy] = v.center(m.x, m.y);
  r.blit(spriteCanvas(MINE, { team: m.team, key: 'mine' }), cx - 3, cy - 2);
}

export function drawGoal(r, v, x, y) {
  const [cx, cy] = v.center(x, y);
  r.blit(spriteCanvas(GOAL_FLAG, { key: 'goal' }), cx + 3, cy - 13);
}

/** A unit standing with its feet at (fx, fy); `bob` lifts it 1px for the idle animation. */
export function drawUnit(r, u, fx, fy, bob = 0) {
  // Team base under the feet: a ring for the player, a solid disc for the CPU.
  const cpu = u.team === 'cpu';
  for (let dy = -2; dy <= 2; dy++) {
    const hw = [3, 6, 7, 6, 3][dy + 2];
    for (let i = -hw; i <= hw; i++) {
      const edge = Math.abs(i) === hw || Math.abs(dy) === 2;
      if (cpu || edge) r.px(fx + i, fy + 1 + dy, DARK);
      else if (PAT.half(fx + i, fy + 1 + dy)) r.px(fx + i, fy + 1 + dy, DARK);
    }
  }
  r.blit(unitSprite(u.type, u.team), fx - 7, fy - FOOT_ROW - bob);
}

export function drawBullet(r, x, y, angle) {
  const left = Math.cos(angle) < 0;
  r.blit(spriteCanvas(BULLET, { mirror: left, key: 'bullet' }), x - 3, y - 1);
}

export function escortStar(r, fx, fy) {
  r.blit(spriteCanvas(STAR, { key: 'star' }), fx - 3, fy - FOOT_ROW - 9);
}

export function dangerMark(r, fx, fy) {
  r.blit(spriteCanvas(DIES, { key: 'dies' }), fx - 14, fy - FOOT_ROW - 2);
}

// ---- markers -------------------------------------------------------------------

export function reachMarks(r, v, cells, teleport = false) {
  for (const [x, y] of cells) {
    const [ox, oy] = v.origin(x, y, v.standHeight(x, y));
    r.pixels(INSET2, ox, oy, DARK, teleport ? 2 : 4, teleport ? 1 : 2);
    if (teleport) {
      const [cx, cy] = v.center(x, y, v.standHeight(x, y));
      r.px(cx, cy - 1, DARK); r.px(cx - 1, cy, DARK); r.px(cx + 1, cy, DARK); r.px(cx, cy + 1, DARK);
    }
  }
}

/** The selected unit's hex: a thick ring that blinks between solid and dashed. */
export function selectRing(r, v, x, y, frame = 0) {
  const [ox, oy] = v.origin(x, y, v.standHeight(x, y));
  r.pixels(RING, ox, oy, DARK, frame % 2 ? 3 : 1, frame % 2 ? 2 : 1);
  r.pixels([...OUTLINE.top, ...OUTLINE.right, ...OUTLINE.bottom], ox, oy, DARK);
}

/** Hexes struck or shot through this turn: diagonal hatching on the top face. */
export function dangerTiles(r, v, cells) {
  for (const [x, y] of cells) {
    const [ox, oy] = v.origin(x, y, v.standHeight(x, y));
    r.face(ox, oy, DARK, PAT.diag, 1);
  }
}

/** Target brackets on a hex (the unit there gets hit). */
export function target(r, v, x, y) {
  const [ox, oy] = v.origin(x, y, v.standHeight(x, y));
  const x0 = ox + 2;
  const x1 = ox + W - 3;
  const y0 = oy + 2;
  const y1 = oy + H - 3;
  for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
    r.line(cx, cy, cx + sx * 3, cy, DARK);
    r.line(cx, cy, cx, cy + sy * 3, DARK);
  }
}

// Intent styles: CPU attacks bold, CPU moves light, player orders dotted with hollow heads.
const STYLE = {
  cpu: { every: 3, on: 2, head: 5, hollow: false, thick: true },
  cpuMove: { every: 2, on: 1, head: 4, hollow: false },
  player: { every: 2, on: 1, head: 5, hollow: true },
};

function path(r, pts, st, { thick = st.thick ?? false } = {}) {
  if (pts.length < 2) return;
  const [ax, ay] = pts[pts.length - 2];
  const [bx, by] = pts[pts.length - 1];
  const end = [ax + (bx - ax) * 0.75, ay + (by - ay) * 0.75];
  const all = [...pts.slice(0, -1), end];
  let phase = 0;
  for (let i = 1; i < all.length; i++) {
    r.line(all[i - 1][0], all[i - 1][1], all[i][0], all[i][1], DARK, { every: st.every, on: st.on, phase });
    if (thick) r.line(all[i - 1][0], all[i - 1][1] + 1, all[i][0], all[i][1] + 1, DARK, { every: st.every, on: st.on, phase });
    phase += Math.max(Math.abs(all[i][0] - all[i - 1][0]), Math.abs(all[i][1] - all[i - 1][1]));
  }
  r.arrowhead(end[0], end[1], Math.atan2(by - ay, bx - ax), st.head, DARK, { hollow: st.hollow });
}

/**
 * What one queue entry will do, drawn from the board as it is now. Returns
 * where its number badge goes (art px), or null.
 */
export function drawIntent(r, v, game, entry) {
  const stand = (x, y) => v.center(x, y, v.standHeight(x, y));
  if (entry.projectileId !== undefined) {
    const p = game.getProjectile(entry.projectileId);
    if (!p) return null;
    const team = game.getUnit(p.ownerId)?.team ?? 'cpu';
    shotRay(r, v, game, p.x, p.y, p.dir, p.speed, team === 'cpu' ? STYLE.cpu : STYLE.player);
    const [bx, by] = v.center(p.x, p.y);
    return [bx + 6, by - CHEST - 6];
  }
  const u = game.getUnit(entry.unitId);
  if (!u) return null;
  const { order } = entry;
  const def = getUnitType(u.type);
  const cpu = u.team === 'cpu';
  const st = cpu ? STYLE.cpu : STYLE.player;
  switch (order.type) {
    case 'move': {
      path(r, movePath(game, u, order.x, order.y).map(([x, y]) => stand(x, y)), cpu ? STYLE.cpuMove : st);
      break;
    }
    case 'attack':
      if (def.attack?.kind === 'projectile') shotRay(r, v, game, u.x, u.y, order.dir, def.attack.speed, st);
      else if (def.attack) {
        const cells = [];
        let [x, y] = [u.x, u.y];
        for (let i = 0; i < def.attack.reach; i++) {
          [x, y] = step(x, y, order.dir);
          if (game.inBounds(x, y)) cells.push([x, y]);
        }
        if (cells.length) path(r, [stand(u.x, u.y), stand(...cells[0])], st);
        for (const [cx, cy] of cells) if (game.unitAt(cx, cy)) target(r, v, cx, cy);
      }
      break;
    case 'charge': {
      const plan = chargePlan(game, u, order.dir);
      path(r, plan.path.map(([x, y]) => stand(x, y)), st, { thick: true });
      for (const [x, y] of plan.strike) if (game.unitAt(x, y)) target(r, v, x, y);
      break;
    }
    case 'teleport': {
      const [ax, ay] = stand(u.x, u.y);
      const [bx, by] = stand(order.x, order.y);
      const mx = (ax + bx) / 2;
      const my = Math.min(ay, by) - 18;
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push([(1 - t) ** 2 * ax + 2 * (1 - t) * t * mx + t * t * bx, (1 - t) ** 2 * ay + 2 * (1 - t) * t * my + t * t * by]);
      }
      path(r, pts, cpu ? STYLE.cpuMove : st);
      break;
    }
    case 'build': {
      const saved = r.fade;
      r.fade = PAT.half;
      drawBuilding(r, v, { x: u.x, y: u.y, team: u.team, id: -1 }, 1);
      r.fade = saved;
      break;
    }
    default:
  }
  const [fx, fy] = stand(u.x, u.y);
  return [fx + 8, fy - FOOT_ROW - 3];
}

function shotRay(r, v, game, x, y, dir, speed, st) {
  const now = rayCells(game, x, y, dir, speed);
  if (!now.length) return;
  const pt = ([cx, cy]) => {
    const [sx, sy] = v.center(cx, cy);
    return [sx, sy - CHEST];
  };
  path(r, [pt([x, y]), ...now.map(pt)], st);
  for (const [cx, cy] of now) {
    if (game.unitAt(cx, cy) || game.buildingAt(cx, cy)) {
      target(r, v, cx, cy);
      break;
    }
  }
}

/** A queue number plate: dark for the CPU, light for the player; fast entries get a second border. */
export function badge(r, x, y, n, { dark, fast = false, active = false }) {
  const s = String(n);
  const w = textWidth(s) + 4;
  const x0 = Math.round(x - w / 2);
  const y0 = Math.round(y - 4);
  if (active || fast) {
    for (let i = -1; i <= w; i++) { r.px(x0 + i, y0 - 1, active ? DARK : (i & 1 ? DARK : LIGHT)); r.px(x0 + i, y0 + 9, active ? DARK : (i & 1 ? DARK : LIGHT)); }
    for (let j = -1; j <= 9; j++) { r.px(x0 - 1, y0 + j, DARK); r.px(x0 + w, y0 + j, DARK); }
  }
  r.rect(x0, y0, w, 9, dark ? DARK : LIGHT);
  // Border in the opposite tone so the plate reads on any background.
  const edge = dark ? LIGHT : DARK;
  r.line(x0, y0, x0 + w - 1, y0, edge);
  r.line(x0, y0 + 8, x0 + w - 1, y0 + 8, edge);
  r.line(x0, y0, x0, y0 + 8, edge);
  r.line(x0 + w - 1, y0, x0 + w - 1, y0 + 8, edge);
  r.text(s, x0 + 2, y0 + 2, dark ? LIGHT : DARK);
}

/** Arrows round a unit for picking an attack / charge direction. */
export function aimArrows(r, v, u, dirs) {
  const [ux, uy] = v.center(u.x, u.y, v.standHeight(u.x, u.y));
  for (const dir of dirs) {
    const [tx, ty] = v.center(...step(u.x, u.y, dir), v.standHeight(u.x, u.y));
    const a = Math.atan2(ty - uy, tx - ux);
    const tip = [ux + (tx - ux) * 0.85, uy + (ty - uy) * 0.85];
    r.line(ux + (tx - ux) * 0.5, uy + (ty - uy) * 0.5, tip[0], tip[1], DARK);
    r.arrowhead(tip[0], tip[1], a, 4, DARK, { hollow: true });
  }
}

/** Explosion / hit burst, growing with t (0..1). */
export function boom(r, x, y, size, t) {
  const n = 8;
  const r0 = 2 + t * 4 * size;
  const r1 = 5 + t * 9 * size;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.2;
    r.line(x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.7, x + Math.cos(a) * r1, y + Math.sin(a) * r1 * 0.7, DARK);
  }
  if (t < 0.6) {
    for (let j = -2; j <= 2; j++) for (let i = -3; i <= 3; i++) if (Math.abs(i) + Math.abs(j) < 4) r.px(x + i, y + j, PAT.half(x + i, y + j) ? DARK : LIGHT);
  }
}

/** Flash over struck hexes. */
export function strikeFlash(r, v, cells, t) {
  for (const [x, y] of cells) {
    const [ox, oy] = v.origin(x, y, v.standHeight(x, y));
    r.face(ox, oy, DARK, t < 0.5 ? PAT.half : PAT.diag2, 1);
  }
}

/** Direction angle on the board (for bullets). */
export function dirAngle(dir) {
  const a = DIRECTION_ANGLES[dir];
  return Math.atan2(Math.sin(a) * (V_SLOPE), Math.cos(a));
}
const V_SLOPE = 11 / (W * 0.866);

export { INSET4, UNITS };
