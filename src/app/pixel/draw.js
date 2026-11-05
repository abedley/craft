// Everything drawn on the pixel board, in colour: flat terrain tiles,
// buildings, mines, the goal flag, units, order intents, markers and
// playback effects. All drawing goes through a Raster on the art buffer.

import { W, H, Q, S, BASE, MASK, BOTTOM_ROW, OUTLINE as EDGES, RING, insetOutline, inMask, BUILDING_HEIGHT, V } from './grid.js';
import { PAT, textWidth } from './raster.js';
import { C, OUTLINE, teamOf } from './palette.js';
import { FOOT_ROW, UNIT_W, unitSprite, sprite } from './sprites.js';
import { chargePlan, getUnitType, DIRECTION_ANGLES } from '../../engine/index.js';
import { step } from '../../engine/hex.js';
import { movePath, rayCells } from '../shared.js';

const INSET3 = insetOutline(3);
export const CHEST = 18; // shots fly this many px above the ground

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

const LOOK = {
  grass: { top: C.grass, edge: C.grassEdge, side: C.earth },
  forest: { top: C.forest, edge: C.forestEdge, side: C.earth },
  road: { top: C.road, edge: C.roadEdge, side: C.earth },
  sand: { top: C.sand, edge: C.sandEdge, side: C.earth },
  water: { top: C.water, edge: C.waterEdge, side: C.stone },
};
const lookOf = (key) => LOOK[key] ?? LOOK.grass;

/** The board's backdrop: a calm light ground with a sparse dither. */
export function drawBackdrop(r, w, h) {
  r.rect(0, 0, w, h, C.board);
  for (let y = 0; y < h; y += 2) for (let x = (y / 2) % 4 === 0 ? 0 : 2; x < w; x += 4) if (((x * 7 + y * 13) & 15) === 0) r.px(x, y, C.boardDither);
}

/** Every hex, back to front. `frame` (0/1) animates the water. */
export function drawTerrain(r, v, frame = 0) {
  for (const [x, y] of v.drawOrder()) drawTile(r, v, x, y, frame);
}

export function drawTile(r, v, x, y, frame = 0) {
  const key = v.game.terrainAt(x, y);
  const look = lookOf(key);
  const [ox, oy] = v.origin(x, y);
  // A thin edge under the tile (only seen along the board's front edge).
  const [sl, , sd] = look.side;
  for (let c = 0; c < W; c++) {
    const y0 = oy + BOTTOM_ROW[c] + 1;
    for (let d = 0; d < BASE; d++) r.px(ox + c, y0 + d, d === BASE - 1 ? OUTLINE : c < W / 2 ? sl : sd);
  }
  // Top face: one flat tone, so units read clearly against it.
  const tb = look.top[1];
  for (let row = 0; row < H; row++) {
    const [x0, x1] = MASK[row];
    r.rect(ox + x0, oy + row, x1 - x0, 1, tb);
  }
  texture(r, key, ox, oy, x, y, look, frame);
  // Outline in the tile's own dark tone: top edges by every tile (shared edges
  // drawn once), right and bottom only at the board's edge.
  r.pixels(EDGES.top, ox, oy, look.edge);
  const edge = (nx, ny) => !v.inBounds(nx, ny);
  if (edge(...step(x, y, 'right'))) r.pixels(EDGES.right, ox, oy, look.edge);
  if (edge(...step(x, y, 'down-left')) || edge(...step(x, y, 'down-right'))) r.pixels(EDGES.bottom, ox, oy, look.edge);
}

/** A light, flat texture per terrain: just enough to tell the tiles apart. */
function texture(r, key, ox, oy, x, y, look, frame) {
  const rand = rng((x * 73856093) ^ (y * 19349663) ^ (key.length * 83492791));
  const [tl, , td] = look.top;
  // A random point well inside the face.
  const spot = (m = 5) => {
    for (let tries = 0; tries < 50; tries++) {
      const sx = Math.floor(rand() * W);
      const sy = Math.floor(rand() * H);
      const my = Math.ceil(m / 2);
      if (inMask(sx - m, sy) && inMask(sx + m, sy) && inMask(sx, sy - my) && inMask(sx, sy + my)) return [ox + sx, oy + sy];
    }
    return [ox + W / 2, oy + Math.floor(H / 2)];
  };
  switch (key) {
    case 'grass': {
      for (let i = 0; i < 4; i++) {
        const [bx, by] = spot();
        r.px(bx, by, td); r.px(bx + 2, by, td); r.px(bx + 1, by - 1, td);
      }
      break;
    }
    case 'forest': {
      // Tree crowns seen from above: flat dark rounds with a light fleck.
      const crowns = [[-10, -3], [9, -4], [-1, 6], [11, 6], [-12, 7]];
      for (const [dx, dy] of crowns) {
        if (rand() < 0.25) continue;
        const cx = ox + W / 2 + dx;
        const cy = oy + Math.floor(H / 2) + dy;
        for (let j = -2; j <= 2; j++) {
          const hw = Math.abs(j) === 2 ? 2 : 3;
          for (let i = -hw; i <= hw; i++) if (inMask(cx + i - ox, cy + j - oy)) r.px(cx + i, cy + j, td);
        }
        r.px(cx - 1, cy - 1, tl);
      }
      break;
    }
    case 'road': {
      // Faint cobble seams.
      for (let row = 5; row < H - 4; row += 6) {
        const shift = (row / 6) % 2 ? 4 : 0;
        for (let c = shift + 3; c < W - 3; c += 8) if (inMask(c, row) && inMask(c + 3, row)) r.rect(ox + c, oy + row, 3, 1, td);
      }
      break;
    }
    case 'sand': {
      for (let i = 0; i < 6; i++) r.px(...spot(3), td);
      break;
    }
    case 'water': {
      // A few light ripples, shifted by the frame.
      for (let row = 7; row < H - 5; row += 8) {
        const len = 4 + Math.floor(rand() * 3);
        const sx = 8 + Math.floor(rand() * (W - 20)) + (frame ? 2 : 0);
        for (let k = 0; k < len; k++) if (inMask(sx + k, row)) r.px(ox + sx + k, oy + row, tl);
      }
      break;
    }
    default:
      for (let i = 0; i < 4; i++) r.px(...spot(), td);
  }
}

// ---- things on the board -------------------------------------------------------

/** A building: stone walls with a window and door, a team-colour tiled roof and flag. */
export function drawBuilding(r, v, b, rise = 1) {
  const t = teamOf(b.team);
  const [cx, gy] = v.center(b.x, b.y);
  const hh = Math.round(BUILDING_HEIGHT * rise);
  const ry = gy - hh;
  const half = 16;
  const slope = (dx) => Math.round((Math.abs(dx) * 8) / half);
  // Walls, column by column (left face lit, right face shaded).
  for (let dx = -half; dx <= half; dx++) {
    const yTop = ry + 8 - slope(dx);
    for (let d = 0; d <= hh; d++) {
      const px = cx + dx;
      const py = yTop + d;
      let col;
      if (dx === -half || dx === half || d === hh) col = OUTLINE;
      else if (dx === 0) col = C.wall[2];
      else if (dx < 0) col = d % 6 === 5 ? C.wall[1] : C.wall[0];
      else col = d % 6 === 5 ? C.wall[2] : C.wall[1];
      r.px(px, py, col);
    }
  }
  if (rise > 0.7) {
    // Door on the lit face, a window on the shaded face.
    for (let i = 0; i < 5; i++) {
      const dx = -11 + i;
      const bottom = ry + 8 - slope(dx) + hh - 1;
      for (let j = 0; j < 9; j++) r.px(cx + dx, bottom - j, j === 8 || i === 0 || i === 4 ? OUTLINE : C.wood[i < 2 ? 1 : 2]);
    }
    for (let i = 0; i < 6; i++) {
      const dx = 6 + i;
      const top = ry + 8 - slope(dx) + 4;
      for (let j = 0; j < 5; j++) r.px(cx + dx, top + j, j === 0 || j === 4 || i === 0 || i === 5 ? OUTLINE : j === 1 && i < 3 ? C.window[0] : C.window[1]);
    }
  }
  // Roof: a flat diamond in team colour with tile rows.
  for (let dx = -half; dx <= half; dx++) {
    const span = 8 - slope(dx);
    for (let dy = -span; dy <= span; dy++) {
      const px = cx + dx;
      const py = ry + dy;
      let col = t.main;
      if (Math.abs(dy) === span || Math.abs(dx) === half) col = OUTLINE;
      else if (dy < -span + 2) col = t.light;
      else if ((py + Math.floor(dx / 4)) % 3 === 0) col = t.dark;
      r.px(px, py, col);
    }
  }
  if (rise >= 1) {
    // Team flag on the back corner.
    const fx = cx;
    const fy = ry - 8;
    r.rect(fx, fy - 14, 2, 15, C.metal[2]);
    for (let j = 0; j < 7; j++) for (let i = 2; i <= 10 - j; i++) r.px(fx + i, fy - 14 + j, j === 0 || i === 10 - j ? OUTLINE : j < 2 ? t.light : t.main);
  }
}

export function drawMine(r, v, m) {
  const [cx, cy] = v.center(m.x, m.y);
  r.blit(sprite.mine(m.team), cx - 7, cy - 5);
}

export function drawGoal(r, v, x, y) {
  const [cx, cy] = v.center(x, y);
  r.blit(sprite.goal(), cx + 4, cy - 32);
}

/** A unit with its feet at (fx, fy); `bob` lifts it 1px for the idle animation. */
export function drawUnit(r, u, fx, fy, bob = 0) {
  // Soft dithered shadow.
  for (let dy = -2; dy <= 2; dy++) {
    const hw = [5, 9, 10, 9, 5][dy + 2];
    for (let i = -hw; i <= hw; i++) if (PAT.half(fx + i, fy + dy)) r.px(fx + i, fy + dy, C.shadow);
  }
  r.blit(unitSprite(u.type, u.team), fx - Math.floor(UNIT_W / 2), fy - FOOT_ROW - bob);
}

export function drawBullet(r, x, y, angle) {
  r.blit(sprite.bullet(Math.cos(angle) < 0), x - 7, y - 3);
}

export function escortStar(r, fx, fy) {
  r.blit(sprite.star(), fx - 7, fy - FOOT_ROW - 16);
}

export function dangerMark(r, fx, fy) {
  r.blit(sprite.dies(), fx - 24, fy - FOOT_ROW + 2);
}

// ---- markers -------------------------------------------------------------------

export function reachMarks(r, v, cells, teleport = false) {
  for (const [x, y] of cells) {
    const [ox, oy] = v.origin(x, y, v.standHeight(x, y));
    r.face(ox, oy, C.reachTint, PAT.quarter, 3);
    r.pixels(INSET3, ox, oy, C.reach, teleport ? 2 : 5, teleport ? 1 : 3);
    if (teleport) {
      const [cx, cy] = v.center(x, y, v.standHeight(x, y));
      r.rect(cx - 1, cy - 2, 2, 4, C.reach);
      r.rect(cx - 2, cy - 1, 4, 2, C.reach);
    }
  }
}

/** The selected unit's hex: a yellow ring that pulses. */
export function selectRing(r, v, x, y, frame = 0) {
  const [ox, oy] = v.origin(x, y, v.standHeight(x, y));
  r.pixels(RING, ox, oy, frame % 2 ? C.select : OUTLINE);
  r.pixels([...EDGES.top, ...EDGES.right, ...EDGES.bottom], ox, oy, C.select);
}

/** Hexes struck or shot through this turn: an orange checker over the face. */
export function dangerTiles(r, v, cells) {
  for (const [x, y] of cells) {
    const [ox, oy] = v.origin(x, y, v.standHeight(x, y));
    r.face(ox, oy, C.danger, PAT.half, 2);
    r.pixels(INSET3, ox, oy, C.dangerEdge, 4, 2);
  }
}

/** Target brackets on a hex (the unit there gets hit); they blink red / yellow. */
export function target(r, v, x, y, frame = 0) {
  const [ox, oy] = v.origin(x, y, v.standHeight(x, y));
  const x0 = ox + 4;
  const x1 = ox + W - 6;
  const y0 = oy + 3;
  const y1 = oy + H - 5;
  const c = frame % 2 ? C.targetAlt : C.target;
  for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
    for (const k of [0, 1]) {
      r.line(cx, cy + sy * k, cx + sx * 6, cy + sy * k, c);
      r.line(cx + sx * k, cy, cx + sx * k, cy + sy * 5, c);
    }
  }
}

/** How an intent is drawn: every order at full strength, moves dashed finer than attacks. */
function styleOf(team, kind) {
  const t = teamOf(team);
  const move = kind === 'move';
  return { color: t.order, every: move ? 3 : 4, on: move ? 2 : 3, head: 8, hollow: team !== 'cpu', thick: true };
}

/** A dashed arrow through hex centres: it starts at the first hex's centre and its tip lands on the last's. */
function path(r, pts, st) {
  if (pts.length < 2) return;
  const [ax, ay] = pts[pts.length - 2];
  const [bx, by] = pts[pts.length - 1];
  const end = [bx, by];
  const all = pts;
  let phase = 0;
  for (let i = 1; i < all.length; i++) {
    const [x0, y0] = all[i - 1];
    const [x1, y1] = all[i];
    r.line(x0, y0, x1, y1, st.color, { every: st.every, on: st.on, phase });
    if (st.thick) r.line(x0, y0 + 1, x1, y1 + 1, st.color, { every: st.every, on: st.on, phase });
    phase += Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  }
  const a = Math.atan2(by - ay, bx - ax);
  r.arrowhead(end[0] + Math.cos(a), end[1] + Math.sin(a) + 1, a, st.head, OUTLINE);
  r.arrowhead(end[0], end[1], a, st.head, st.color, { hollow: st.hollow, fill: C.white });
}

/**
 * What one queue entry will do, drawn from the board as it is now. Returns
 * where its number badge goes (art px), or null.
 */
export function drawIntent(r, v, game, entry, frame = 0) {
  const stand = (x, y) => v.center(x, y, v.standHeight(x, y));
  if (entry.projectileId !== undefined) {
    const p = game.getProjectile(entry.projectileId);
    if (!p) return null;
    const team = game.getUnit(p.ownerId)?.team ?? 'cpu';
    shotRay(r, v, game, p.x, p.y, p.dir, p.speed, styleOf(team, 'attack'), frame);
    const [bx, by] = v.center(p.x, p.y);
    return [bx + 12, by - CHEST - 10];
  }
  const u = game.getUnit(entry.unitId);
  if (!u) return null;
  const { order } = entry;
  const def = getUnitType(u.type);
  const st = styleOf(u.team, 'attack');
  switch (order.type) {
    case 'move':
      path(r, movePath(game, u, order.x, order.y).map(([x, y]) => stand(x, y)), styleOf(u.team, 'move'));
      break;
    case 'attack':
      if (def.attack?.kind === 'projectile') shotRay(r, v, game, u.x, u.y, order.dir, def.attack.speed, st, frame);
      else if (def.attack) {
        const cells = [];
        let [x, y] = [u.x, u.y];
        for (let i = 0; i < def.attack.reach; i++) {
          [x, y] = step(x, y, order.dir);
          if (game.inBounds(x, y)) cells.push([x, y]);
        }
        if (cells.length) path(r, [stand(u.x, u.y), stand(...cells[0])], st);
        for (const [cx, cy] of cells) if (game.unitAt(cx, cy)) target(r, v, cx, cy, frame);
      }
      break;
    case 'charge': {
      const plan = chargePlan(game, u, order.dir);
      path(r, plan.path.map(([x, y]) => stand(x, y)), st);
      for (const [x, y] of plan.strike) if (game.unitAt(x, y)) target(r, v, x, y, frame);
      break;
    }
    case 'teleport': {
      const [ax, ay] = stand(u.x, u.y);
      const [bx, by] = stand(order.x, order.y);
      const mx = (ax + bx) / 2;
      const my = Math.min(ay, by) - 34;
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const k = i / 12;
        pts.push([(1 - k) ** 2 * ax + 2 * (1 - k) * k * mx + k * k * bx, (1 - k) ** 2 * ay + 2 * (1 - k) * k * my + k * k * by]);
      }
      path(r, pts, styleOf(u.team, 'move'));
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
  return [fx + 14, fy - FOOT_ROW - 2];
}

function shotRay(r, v, game, x, y, dir, speed, st, frame) {
  const now = rayCells(game, x, y, dir, speed);
  if (!now.length) return;
  const pt = ([cx, cy]) => v.center(cx, cy, v.standHeight(cx, cy));
  path(r, [pt([x, y]), ...now.map(pt)], st);
  for (const [cx, cy] of now) {
    if (game.unitAt(cx, cy) || game.buildingAt(cx, cy)) {
      target(r, v, cx, cy, frame);
      break;
    }
  }
}

/** A queue number plate in team colour; fast entries get a yellow border, the active step a white one. */
export function badge(r, x, y, n, { team = 'cpu', fast = false, active = false }) {
  const s = String(n);
  const w = textWidth(s) + 8;
  const x0 = Math.round(x - w / 2);
  const y0 = Math.round(y - 8);
  if (active || fast) r.rect(x0 - 2, y0 - 2, w + 4, 20, active ? C.white : C.select);
  r.plate(x0, y0, w, 16, teamOf(team).plate);
  r.text(s, x0 + 4, y0 + 3, C.white);
}

/** Arrows round a unit for picking an attack / charge direction. */
export function aimArrows(r, v, u, dirs) {
  const [ux, uy] = v.center(u.x, u.y, v.standHeight(u.x, u.y));
  for (const dir of dirs) {
    const [tx, ty] = v.center(...step(u.x, u.y, dir), v.standHeight(u.x, u.y));
    const a = Math.atan2(ty - uy, tx - ux);
    const tip = [ux + (tx - ux) * 0.85, uy + (ty - uy) * 0.85];
    r.line(ux + (tx - ux) * 0.5, uy + (ty - uy) * 0.5, tip[0], tip[1], C.reach);
    r.line(ux + (tx - ux) * 0.5, uy + (ty - uy) * 0.5 + 1, tip[0], tip[1] + 1, C.reach);
    r.arrowhead(tip[0] + 1, tip[1] + 1, a, 7, OUTLINE);
    r.arrowhead(tip[0], tip[1], a, 7, C.reach, { hollow: true, fill: C.white });
  }
}

/** Explosion / hit burst, growing with t (0..1). */
export function boom(r, x, y, size, t) {
  const n = 10;
  const r0 = 3 + t * 8 * size;
  const r1 = 9 + t * 16 * size;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.2;
    const c = i % 2 ? C.danger : C.hardhat[0];
    r.line(x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.7, x + Math.cos(a) * r1, y + Math.sin(a) * r1 * 0.7, c);
  }
  if (t < 0.6) {
    const rad = 6 * size * (1 - t);
    for (let j = -rad; j <= rad; j++) {
      for (let i = -rad * 1.3; i <= rad * 1.3; i++) {
        const d = (i / 1.3) ** 2 + j ** 2;
        if (d <= rad * rad) r.px(x + i, y + j, d < (rad * rad) / 4 ? C.white : d < (rad * rad) / 1.8 ? C.hardhat[0] : C.danger);
      }
    }
  }
}

/** Flash over struck hexes. */
export function strikeFlash(r, v, cells, t) {
  for (const [x, y] of cells) {
    const [ox, oy] = v.origin(x, y, v.standHeight(x, y));
    r.face(ox, oy, t < 0.5 ? C.white : C.danger, PAT.half, 2);
  }
}

/** Direction angle on the board (for bullets). */
export function dirAngle(dir) {
  const a = DIRECTION_ANGLES[dir];
  return Math.atan2(Math.sin(a) * (V / (W * 0.866)), Math.cos(a));
}

export { Q, S };
