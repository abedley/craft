// Canvas renderer for the board. Purely a view: it reads game state and
// draws; it never mutates the game.
//
// The board is flat-topped hexes in odd-q offset layout (see engine/hex.js).
// `size` is the hex radius (centre to corner); `cell` is the distance between
// neighbouring hex centres and is used to scale everything drawn in a cell.

import {
  UnitTypes, AttackKind, strikeCells, chargePlan, getTerrainType, step, fromAxial, axialRound, DIRECTION_ANGLES,
} from '../engine/index.js';

const SQRT3 = Math.sqrt(3);

/** Board size in units of the hex radius: [width, height]. */
function boardExtent(game) {
  return [1.5 * (game.width - 1) + 2, SQRT3 * (game.height + 0.5)];
}

const COLORS = {
  grid: '#2b323c',
  selected: '#ffffff',
  queuedOrder: '#ffd166',
  preview: '#5fd38d',
  blocked: '#ff6b6b',
  projectile: '#ffa94d',
  shotLine: 'rgba(255,169,77,0.8)',
  quick: '#6ff2ff',
  charge: '#c49bff',
  label: '#0d1014',
};

export const TEAM_COLORS = { player: '#4da3ff', cpu: '#e8619f' };
export const unitColor = (u) => TEAM_COLORS[u.team] ?? '#aaaaaa';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cell = 0;
    this.size = 0;
  }

  /** Match the canvas backing store to its CSS size and device pixel ratio. */
  resize(game) {
    // Give the canvas the board's own aspect ratio so hexes fill it.
    const [bw, bh] = boardExtent(game);
    if (this.canvas.parentElement) this.canvas.parentElement.style.aspectRatio = `${bw} / ${bh}`;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.layout(game);
  }

  layout(game) {
    const [bw, bh] = boardExtent(game);
    this.size = Math.min(this.cssW / bw, this.cssH / bh);
    this.cell = this.size * SQRT3;
    // Centre of hex (0, 0).
    this.ox = (this.cssW - bw * this.size) / 2 + this.size;
    this.oy = (this.cssH - bh * this.size) / 2 + (SQRT3 / 2) * this.size;
  }

  /** Convert a pointer event to a hex, or null if outside the board. */
  cellFromEvent(ev, game) {
    const rect = this.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left - this.ox;
    const py = ev.clientY - rect.top - this.oy;
    const q = ((2 / 3) * px) / this.size;
    const r = ((-1 / 3) * px + (SQRT3 / 3) * py) / this.size;
    const [x, y] = fromAxial(...axialRound(q, r));
    return game.inBounds(x, y) ? { x, y } : null;
  }

  center(x, y) {
    return [this.ox + 1.5 * this.size * x, this.oy + SQRT3 * this.size * (y + 0.5 * (x & 1))];
  }

  /** Trace a flat-topped hexagon. */
  hexPath(cx, cy, radius) {
    const { ctx } = this;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k;
      const px = cx + radius * Math.cos(a);
      const py = cy + radius * Math.sin(a);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  /**
   * @param {import('../engine/game.js').Game} game
   * @param {{selectedId:number|null, preview:null|{moved:Map,blocked:Map,projectiles:Array,killed:Set}}} view
   */
  draw(game, { selectedId = null, preview = null, reach = null } = {}) {
    const { ctx, cell } = this;
    this.layout(game);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    // Grid: each hex filled with its terrain colour.
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x < game.width; x++) {
      for (let y = 0; y < game.height; y++) {
        const [cx, cy] = this.center(x, y);
        const terrain = getTerrainType(game.terrainAt(x, y));
        ctx.fillStyle = terrain.color;
        this.hexPath(cx, cy, this.size - 0.5);
        ctx.fill();
        ctx.stroke();
        if (!terrain.walkable) this.drawUnwalkable(cx, cy);
      }
    }

    // Hexes the selected unit can move to this turn.
    if (reach) {
      ctx.save();
      for (const [x, y] of reach) {
        const [cx, cy] = this.center(x, y);
        this.hexPath(cx, cy, this.size - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Orders, straight from the queue: dashed in the team's colour (yellow
    // for the player), quick moves cyan.
    for (const entry of game.queue) {
      if (entry.unitId === undefined) continue;
      const u = game.getUnit(entry.unitId);
      if (!u) continue;
      const { order } = entry;
      if (order.type === 'move') {
        const color = order.quick ? COLORS.quick
          : u.team === 'cpu' ? TEAM_COLORS.cpu : COLORS.queuedOrder;
        this.drawOrderLine(u, order, color, true);
      } else if (order.type === 'charge') {
        this.drawCharge(game, u, order.dir);
      } else if (order.type === 'attack') {
        const atk = UnitTypes[u.type].attack;
        if (atk.kind === AttackKind.PROJECTILE) this.drawShotLine(game, u, order.dir, atk.range);
        else if (atk.kind === AttackKind.MELEE) this.drawStrike(game, u, order.dir, atk.reach);
      }
    }

    // Preview of the next tick.
    if (preview) {
      for (const path of preview.moved.values()) this.drawPathArrow(path, COLORS.preview);
      for (const path of preview.projectiles) this.drawPathArrow(path, COLORS.projectile);
    }

    // Units.
    const r = cell * 0.36;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(cell * 0.32)}px -apple-system, system-ui, sans-serif`;
    for (const u of game.units) {
      const [cx, cy] = this.center(u.x, u.y);
      ctx.fillStyle = unitColor(u);
      ctx.beginPath();
      this.unitShape(UnitTypes[u.type]?.shape ?? 'circle', cx, cy, r);
      ctx.fill();
      if (u.id === selectedId) {
        ctx.strokeStyle = COLORS.selected;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (preview?.blocked.has(u.id)) {
        ctx.strokeStyle = COLORS.blocked;
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (preview?.killed.has(u.id)) this.drawCross(cx, cy, r * 1.1, COLORS.blocked);
      if (preview?.attackBlocked?.has(u.id)) this.drawNoEntry(cx + r * 0.8, cy + r * 0.8);
      ctx.fillStyle = COLORS.label;
      ctx.fillText(String(u.id), cx, cy + 1);
      if (u.speed > 1) this.drawSpeedBadge(cx + r * 0.75, cy - r * 0.75, u.speed);
      if (u.quickMoves > 0) this.drawQuickPip(cx - r * 0.8, cy + r * 0.8);
      if (u.charges > 0) this.drawChargePip(cx - r * 0.8, cy - r * 0.8);
    }

    // Projectiles: a dot with a short tail pointing back the way it came.
    for (const p of game.projectiles) {
      const [cx, cy] = this.center(p.x, p.y);
      const dx = Math.cos(DIRECTION_ANGLES[p.dir]);
      const dy = Math.sin(DIRECTION_ANGLES[p.dir]);
      ctx.strokeStyle = COLORS.projectile;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - dx * cell * 0.4, cy - dy * cell * 0.4);
      ctx.stroke();
      ctx.fillStyle = COLORS.projectile;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Trace a unit's outline (shape comes from its type definition). */
  unitShape(shape, cx, cy, r) {
    const { ctx } = this;
    switch (shape) {
      case 'diamond':
        ctx.moveTo(cx, cy - r * 1.15);
        ctx.lineTo(cx + r * 1.15, cy);
        ctx.lineTo(cx, cy + r * 1.15);
        ctx.lineTo(cx - r * 1.15, cy);
        ctx.closePath();
        break;
      case 'square':
        ctx.rect(cx - r * 0.9, cy - r * 0.9, r * 1.8, r * 1.8);
        break;
      case 'triangle':
        ctx.moveTo(cx, cy - r * 1.15);
        ctx.lineTo(cx + r * 1.1, cy + r * 0.8);
        ctx.lineTo(cx - r * 1.1, cy + r * 0.8);
        ctx.closePath();
        break;
      default:
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
  }

  /** Shade the cells a queued melee attack will strike, in the attacker's team colour. */
  drawStrike(game, u, dir, reach) {
    const { ctx } = this;
    const color = TEAM_COLORS[u.team] ?? '#ffffff';
    const [ax, ay] = this.center(u.x, u.y);
    const cells = strikeCells(u, dir, reach).filter(([x, y]) => game.inBounds(x, y));
    ctx.save();
    for (const [x, y] of cells) {
      const [cx, cy] = this.center(x, y);
      this.hexPath(cx, cy, this.size - 3);
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // The pike itself: a line from the unit through the struck cells.
    if (cells.length) {
      const [bx, by] = this.center(...cells[cells.length - 1]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Dashed ray from a unit to the edge of the grid (or its range) for a queued shot. */
  drawShotLine(game, u, dir, range = null) {
    const { ctx } = this;
    const dx = Math.cos(DIRECTION_ANGLES[dir]);
    const dy = Math.sin(DIRECTION_ANGLES[dir]);
    let [ex, ey] = [u.x, u.y];
    for (let d = 1, next = step(ex, ey, dir); game.inBounds(...next) && (range === null || d <= range); d++, next = step(ex, ey, dir)) {
      [ex, ey] = next;
    }
    const [ax, ay] = this.center(u.x, u.y);
    const [bx, by] = this.center(ex, ey);
    ctx.strokeStyle = COLORS.shotLine;
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx + dx * this.cell * 0.5, by + dy * this.cell * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Red "no" sign: this unit's queued attack will fail. */
  drawNoEntry(x, y) {
    const { ctx, cell } = this;
    const s = cell * 0.14;
    ctx.save();
    ctx.fillStyle = COLORS.label;
    ctx.beginPath();
    ctx.arc(x, y, s * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.blocked;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.moveTo(x - s * 0.7, y - s * 0.7);
    ctx.lineTo(x + s * 0.7, y + s * 0.7);
    ctx.stroke();
    ctx.restore();
  }

  drawCross(cx, cy, m, color) {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - m, cy - m); ctx.lineTo(cx + m, cy + m);
    ctx.moveTo(cx + m, cy - m); ctx.lineTo(cx - m, cy + m);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  /** Two faint wave strokes so unwalkable hexes read differently, not just by colour. */
  drawUnwalkable(cx, cy) {
    const { ctx, size } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    for (const dy of [-0.18, 0.18]) {
      ctx.beginPath();
      const y = cy + dy * size;
      ctx.moveTo(cx - size * 0.45, y);
      ctx.bezierCurveTo(cx - size * 0.2, y - size * 0.15, cx, y + size * 0.15, cx + size * 0.2, y);
      ctx.bezierCurveTo(cx + size * 0.3, y - size * 0.08, cx + size * 0.4, y - size * 0.08, cx + size * 0.45, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A queued charge: its straight path, then the strike it ends with. */
  drawCharge(game, u, dir) {
    const { ctx } = this;
    const plan = chargePlan(game, u, dir);
    if (plan.path.length > 1) {
      const pts = plan.path.map(([x, y]) => this.center(x, y));
      ctx.save();
      ctx.strokeStyle = COLORS.charge;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(...pts[0]);
      for (const p of pts.slice(1)) ctx.lineTo(...p);
      ctx.stroke();
      ctx.setLineDash([]);
      // Ghost of where it ends up.
      const [ex, ey] = pts[pts.length - 1];
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(ex, ey, this.cell * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const atk = UnitTypes[u.type].attack;
    if (atk?.kind === AttackKind.MELEE) this.drawStrike(game, { ...u, x: plan.end.x, y: plan.end.y }, dir, atk.reach);
  }

  /** Small double-chevron pip: this unit still has a charge. */
  drawChargePip(x, y) {
    const { ctx, cell } = this;
    const s = cell * 0.13;
    ctx.save();
    ctx.fillStyle = COLORS.label;
    ctx.beginPath();
    ctx.arc(x, y, s * 1.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.charge;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    for (const dx of [-0.35, 0.25]) {
      ctx.beginPath();
      ctx.moveTo(x + (dx - 0.25) * s, y - 0.55 * s);
      ctx.lineTo(x + (dx + 0.25) * s, y);
      ctx.lineTo(x + (dx - 0.25) * s, y + 0.55 * s);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Small lightning-bolt pip: this unit still has its quick move. */
  drawQuickPip(x, y) {
    const { ctx, cell } = this;
    const s = cell * 0.13;
    ctx.save();
    ctx.fillStyle = COLORS.label;
    ctx.beginPath();
    ctx.arc(x, y, s * 1.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.quick;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.25, y - s * 0.9);
    ctx.lineTo(x - s * 0.45, y + s * 0.1);
    ctx.lineTo(x, y + s * 0.1);
    ctx.lineTo(x - s * 0.25, y + s * 0.9);
    ctx.lineTo(x + s * 0.45, y - s * 0.1);
    ctx.lineTo(x, y - s * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawSpeedBadge(x, y, speed) {
    const { ctx, cell } = this;
    const br = cell * 0.15;
    ctx.fillStyle = COLORS.label;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(cell * 0.2)}px -apple-system, system-ui, sans-serif`;
    ctx.fillText(String(speed), x, y + 1);
    ctx.restore();
  }

  drawOrderLine(u, order, color, dashed) {
    const { ctx, cell } = this;
    const [ax, ay] = this.center(u.x, u.y);
    const [bx, by] = this.center(order.x, order.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (dashed) ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    // Target marker.
    const m = cell * 0.18;
    ctx.beginPath();
    ctx.moveTo(bx - m, by - m); ctx.lineTo(bx + m, by + m);
    ctx.moveTo(bx + m, by - m); ctx.lineTo(bx - m, by + m);
    ctx.stroke();
  }

  /** Polyline through cell centers with an arrowhead on the last segment. */
  drawPathArrow(path, color) {
    if (path.length < 2) return;
    const { ctx, cell } = this;
    const pts = path.map(([x, y]) => this.center(x, y));
    const [ax, ay] = pts[pts.length - 2];
    const [bx, by] = pts[pts.length - 1];
    const ang = Math.atan2(by - ay, bx - ax);
    const tipX = bx - Math.cos(ang) * cell * 0.2;
    const tipY = by - Math.sin(ang) * cell * 0.2;
    const h = cell * 0.18;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length - 1; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tipX + Math.cos(ang) * h * 0.4, tipY + Math.sin(ang) * h * 0.4);
    ctx.lineTo(tipX - Math.cos(ang - 0.5) * h, tipY - Math.sin(ang - 0.5) * h);
    ctx.lineTo(tipX - Math.cos(ang + 0.5) * h, tipY - Math.sin(ang + 0.5) * h);
    ctx.closePath();
    ctx.fill();
  }
}
