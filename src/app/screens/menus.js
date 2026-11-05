// Title and campaign screens.

import { LEVELS, CAMPAIGN } from '../campaign.js';
import { PixelView } from '../pixel/grid.js';
import { Raster } from '../pixel/raster.js';
import { C } from '../pixel/palette.js';
import { drawBackdrop, drawTerrain, drawBuilding, drawGoal, drawUnit } from '../pixel/draw.js';
import { h, esc } from '../dom.js';

/** A small pixel diorama for the title screen, scaled up by whole device pixels. */
function drawVignette(canvas, w, hgt) {
  const rows = ['.f=.', '~~=~', '.=.f'];
  const terrain = { '.': 'grass', '=': 'road', f: 'forest', '~': 'water' };
  const board = {
    width: 4, height: 3,
    terrain: [],
    terrainAt: (x, y) => terrain[rows[y][x]],
    buildingAt: (x, y) => (x === 0 && y === 2 ? { id: 1, x, y, team: 'player' } : null),
  };
  const v = new PixelView(board, { top: 44, side: 8, bottom: 8 });
  const art = document.createElement('canvas');
  ({ w: art.width, h: art.height } = v.size);
  const r = new Raster(art.getContext('2d'));
  drawBackdrop(r, art.width, art.height);
  drawTerrain(r, v);
  const units = [
    { at: [2, 0], u: { id: 91, type: 'gunslinger', team: 'cpu' } },
    { at: [3, 0], u: { id: 92, type: 'pikeman', team: 'cpu' } },
    { at: [1, 2], u: { id: 93, type: 'builder', team: 'player' } },
    { at: [2, 2], u: { id: 94, type: 'pikeman', team: 'player' } },
  ];
  for (const [x, y] of v.drawOrder()) {
    const b = board.buildingAt(x, y);
    if (b) drawBuilding(r, v, b);
    if (x === 0 && y === 0) drawGoal(r, v, 0, 0);
    const it = units.find((k) => k.at[0] === x && k.at[1] === y);
    if (it) drawUnit(r, it.u, ...v.center(x, y, v.standHeight(x, y)));
  }
  // Scale up by a whole number of device pixels and centre it.
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hgt * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${hgt}px`;
  const k = Math.max(1, Math.floor(Math.min(canvas.width / art.width, canvas.height / art.height)));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = C.board;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(art, Math.floor((canvas.width - art.width * k) / 2), Math.floor((canvas.height - art.height * k) / 2), art.width * k, art.height * k);
}

export function titleScreen(app) {
  const next = app.progress.next;
  const started = LEVELS.some((l) => app.progress.isCleared(l.id));
  const el = h(`
    <div class="screen title">
      <div class="title-art"><canvas></canvas></div>
      <h1>${esc(CAMPAIGN.title.toUpperCase())}</h1>
      <p class="tagline">a tactics game of plans, queues &amp; bad odds</p>
      <div class="col">
        <button class="primary" data-go="play">${started ? 'CONTINUE' : 'START CAMPAIGN'} ▸</button>
        <button data-go="campaign">MISSIONS</button>
      </div>
      <p class="meta">best played upright · tap, drag, pinch</p>
    </div>`);
  el.querySelector('[data-go="play"]').onclick = () => app.show('battle', { levelId: next.id });
  el.querySelector('[data-go="campaign"]').onclick = () => app.show('campaign');
  return {
    el,
    mounted() {
      const box = el.querySelector('.title-art');
      // Inside the border (clientWidth/Height exclude it).
      drawVignette(box.querySelector('canvas'), box.clientWidth, box.clientHeight);
    },
  };
}

export function campaignScreen(app) {
  const el = h(`
    <div class="screen campaign">
      <header class="topbar">
        <button class="icon-btn" data-back aria-label="Back">‹</button>
        <div class="goal">CAMPAIGN</div>
        <span class="icon-btn ghost"></span>
      </header>
      <div class="levels">
        ${LEVELS.map((l, i) => {
    const open = app.progress.isOpen(l.id);
    const done = app.progress.isCleared(l.id);
    return `
          <article class="level ${open ? '' : 'locked'} ${done ? 'done' : ''}">
            <div class="num">${String(i + 1).padStart(2, '0')}</div>
            <div class="body">
              <h2>${esc(l.title.toUpperCase())} ${done ? '<span class="tag">CLEARED</span>' : ''}</h2>
              <p class="goal-line">${esc(l.goal)}</p>
              <p>${esc(l.brief)}</p>
              <ul class="tips">${(l.tips ?? []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
              <button class="primary" data-level="${esc(l.id)}" ${open ? '' : 'disabled'}>${done ? 'PLAY AGAIN' : 'DEPLOY'} ▸</button>
            </div>
          </article>
          <div class="trail"></div>`;
  }).join('')}
        <article class="level locked soon">
          <div class="num">??</div>
          <div class="body"><h2>MORE SOON</h2><p>New missions are on the drawing board.</p></div>
        </article>
      </div>
    </div>`);
  el.querySelector('[data-back]').onclick = () => app.show('title');
  el.querySelectorAll('[data-level]').forEach((b) => {
    b.onclick = () => app.show('battle', { levelId: b.dataset.level });
  });
  return { el };
}
