// The battle screen: top bar, the board, and the bottom sheet
// (turn-order strip, unit card, actions, End Turn / Undo).
//
// Flow: the CPU stages its plan when the turn starts (Match#startTurn) and
// its intents are always drawn. The player taps a unit, picks an action and
// taps the board; each order goes through Match#playerOrder. End Turn runs
// the queue (one tick) and plays the events back step by step on a copy of
// the board from before the tick; then the real state takes over.

import {
  Game, Teams, getUnitType, move, quickMove, attack, charge, teleport, build,
} from '../../engine/index.js';
import { Match, MatchStatus } from '../../match.js';
import { getLevel, startLevel } from '../campaign.js';
import { BattleView } from '../battleView.js';
import { attachGestures } from '../controls.js';
import { nearestDirection, previewOf, moveReach, teleportReach } from '../shared.js';
import { unitSprite } from '../pixel/sprites.js';
import { C } from '../pixel/palette.js';
import { BUILDING_HEIGHT } from '../pixel/grid.js';
import { CHEST } from '../pixel/draw.js';
import { h, esc, crispCanvas } from '../dom.js';

const BOB_MS = 500; // idle animation frame time (units bob, the selection blinks)
const pad2 = (n) => String(n).padStart(2, '0');

const GLYPH = { move: '→', quick: 'ϟ', attack: '✷', shoot: '➶', charge: '»', teleport: '⇢', build: '▣', shot: '•' };

export function battleScreen(app, { levelId }) {
  const level = getLevel(levelId);
  const el = h(`
    <div class="screen battle">
      <header class="topbar">
        <div class="turn"><small>TURN</small><b data-turn>01</b></div>
        <div class="goal" data-goal></div>
        <button class="icon-btn" data-menu aria-label="Menu">☰</button>
      </header>
      <div class="board">
        <canvas aria-label="Battle board"></canvas>
        <button class="icon-btn recenter" data-recenter aria-label="Recenter" hidden>⌖</button>
        <div class="toast" data-toast></div>
        <div class="stamp" data-stamp></div>
        <div class="skip-hint" data-skip hidden>TAP TO SPEED UP</div>
      </div>
      <section class="sheet">
        <div class="queue" data-queue aria-label="Turn order"></div>
        <div class="card" data-card>
          <canvas class="portrait" data-portrait></canvas>
          <div class="info">
            <div class="name" data-name></div>
            <div class="stats" data-stats></div>
            <div class="order" data-order></div>
          </div>
        </div>
        <div class="actions" data-actions></div>
        <div class="turn-row">
          <button data-undo>↶ UNDO TURN</button>
          <button class="primary" data-end>END TURN ▸</button>
        </div>
      </section>
      <div class="overlay" data-overlay hidden></div>
    </div>`);
  const $ = (sel) => el.querySelector(sel);

  const view = new BattleView($('canvas'));
  const s = {
    match: null,
    selectedId: null,
    mode: null, // 'move' | 'quick' | 'attack' | 'charge' | 'teleport'
    preview: null,
    threats: [], // hexes struck or shot through if the turn runs now
    undo: null, // snapshot from before the last End Turn
    playing: false,
    display: null, // the board being played back
    anim: null,
    activeStep: 0,
    speed: 1,
    tweens: [],
    dirty: true,
    boil: -1,
    toastTimer: null,
  };

  function newMatch(game) {
    s.match = new Match(game);
    s.match.startTurn();
    view.setGame(game);
    s.selectedId = null;
    s.mode = null;
    refresh();
  }

  // ---- derived state -------------------------------------------------------

  const game = () => s.match.game;
  const selected = () => (s.selectedId != null ? game().getUnit(s.selectedId) : null);

  function reach() {
    const u = selected();
    if (!u || u.team !== Teams.PLAYER || s.playing) return null;
    if (s.mode === 'move' || s.mode === 'quick') return { cells: moveReach(game(), u), teleport: false };
    if (s.mode === 'teleport') return { cells: teleportReach(game(), u, getUnitType(u.type).teleport.distance), teleport: true };
    return null;
  }

  function aim() {
    const u = selected();
    if (!u || s.playing || (s.mode !== 'attack' && s.mode !== 'charge')) return null;
    return { unit: u, dirs: getUnitType(u.type).attack.directions };
  }

  /** Call after anything changes: recomputes the preview and redraws the sheet. */
  function refresh() {
    s.preview = previewOf(game());
    const seen = new Set();
    s.threats = [...s.preview.struck, ...s.preview.projectiles.flatMap((path) => path.slice(1))]
      .filter(([x, y]) => !seen.has(`${x},${y}`) && seen.add(`${x},${y}`));
    renderSheet();
    s.dirty = true;
  }

  // ---- drawing -------------------------------------------------------------

  function renderBoard(seed) {
    const g = s.display ?? game();
    view.render({
      game: g,
      frame: seed,
      selectedId: s.playing ? null : s.selectedId,
      reach: reach(),
      aim: aim(),
      intents: true,
      activeStep: s.playing ? s.activeStep : 0,
      danger: s.playing ? null : s.preview?.killed,
      threats: s.playing ? null : s.threats,
      focusId: s.playing ? null : s.selectedId,
      anim: s.anim,
    });
    $('[data-recenter]').hidden = !view.cameraMoved;
  }

  function frame(now) {
    if (!el.isConnected) return;
    // Advance tweens.
    if (s.tweens.length) {
      s.dirty = true;
      for (const tw of [...s.tweens]) {
        const t = Math.min(1, (now - tw.t0) / Math.max(1, tw.ms));
        tw.fn(t);
        if (t >= 1) {
          s.tweens.splice(s.tweens.indexOf(tw), 1);
          tw.res();
        }
      }
    }
    const boil = Math.floor(now / BOB_MS) % 2;
    if (boil !== s.boil) {
      s.boil = boil;
      s.dirty = true;
    }
    if (s.dirty) {
      s.dirty = false;
      renderBoard(boil);
    }
    requestAnimationFrame(frame);
  }

  function tween(ms, fn = () => {}) {
    return new Promise((res) => s.tweens.push({ t0: performance.now(), ms: ms * s.speed, fn, res }));
  }
  const wait = (ms) => tween(ms);

  // ---- sheet ---------------------------------------------------------------

  function renderSheet() {
    const g = s.display ?? game();
    $('[data-turn]').textContent = pad2(game().tickCount + 1 - (s.playing ? 1 : 0));
    const obj = g.objective;
    $('[data-goal]').innerHTML = obj?.kind === 'escort'
      ? 'ESCORT <span class="sym">★</span> → <span class="sym">⚑</span>'
      : 'ROUT THE ENEMY';
    renderQueue(g);
    renderCard(g);
    renderActions();
    $('[data-undo]').disabled = s.playing || !s.undo;
    $('[data-end]').disabled = s.playing || s.match.status !== MatchStatus.PLAYING;
  }

  function entryLabel(g, entry) {
    if (entry.projectileId !== undefined) {
      const p = g.getProjectile(entry.projectileId);
      const owner = p && g.getUnit(p.ownerId);
      return { team: owner?.team ?? Teams.CPU, glyph: GLYPH.shot, text: 'SHOT', unitId: p?.ownerId };
    }
    const u = g.getUnit(entry.unitId);
    const o = entry.order;
    const def = u && getUnitType(u.type);
    let glyph = GLYPH[o.type] ?? '?';
    if (o.quick) glyph = GLYPH.quick;
    if (o.type === 'attack' && def?.attack?.kind === 'projectile') glyph = GLYPH.shoot;
    return { team: u?.team ?? Teams.CPU, glyph, text: def ? def.name.slice(0, 3).toUpperCase() : '—', unitId: entry.unitId };
  }

  function renderQueue(g) {
    const q = $('[data-queue]');
    if (!g.queue.length) {
      q.innerHTML = '<span class="empty">No orders yet. The queue runs left to right.</span>';
      return;
    }
    q.innerHTML = g.queue.map((entry, i) => {
      const l = entryLabel(g, entry);
      const cls = [
        'chip', l.team === Teams.CPU ? 'cpu' : 'player',
        s.playing && s.activeStep === i + 1 ? 'active' : '',
        s.playing && s.activeStep > i + 1 ? 'done' : '',
        !s.playing && l.unitId === s.selectedId ? 'sel' : '',
      ].join(' ');
      return `<button class="${cls}" data-chip="${l.unitId ?? ''}"><b>${i + 1}</b>${l.glyph}<span>${l.text}</span></button>`;
    }).join('');
    // Keep the step being played (or the selected unit's chip) in view.
    const chip = q.querySelector('.active, .sel');
    q.scrollLeft = chip ? Math.max(0, chip.offsetLeft - q.offsetLeft - q.clientWidth / 2 + chip.offsetWidth / 2) : 0;
  }

  function statsOf(u) {
    const def = getUnitType(u.type);
    const bits = [`MOVE ${u.speed}`];
    if (def.attack?.kind === 'melee') bits.push(`STRIKE ${def.attack.reach} IN A ROW`);
    if (def.attack?.kind === 'projectile') bits.push(`SHOOT ${def.attack.speed}/TURN`);
    if (def.charge) bits.push(`» CHARGE ${u.charges}/${def.charge.uses}`);
    if (def.teleport) bits.push(`⇢ TELEPORT ${def.teleport.distance}`);
    if (def.teleport?.leavesMine) bits.push(`MINES ${game().minesOf(u.id).length}/${def.teleport.maxMines ?? '∞'}`);
    if (def.build) bits.push(`▣ BUILD ${def.build.turns} TURNS`);
    if (u.team === Teams.PLAYER) bits.push(`ϟ QUICK ${u.quickMoves}`);
    return bits.join(' · ');
  }

  function describeOrder(g, u) {
    const i = g.queue.findIndex((e) => e.unitId === u.id);
    if (i < 0) return u.team === Teams.CPU ? 'NO ORDERS THIS TURN' : 'IDLE — PICK AN ACTION';
    const o = g.queue[i].order;
    const def = getUnitType(u.type);
    const what = {
      move: () => `${o.quick ? 'QUICK ' : ''}MOVE TO ${o.x},${o.y}`,
      attack: () => `${def.attack?.kind === 'projectile' ? 'SHOOT' : 'STRIKE'} ${o.dir.toUpperCase()}`,
      charge: () => `CHARGE ${o.dir.toUpperCase()}`,
      teleport: () => `TELEPORT TO ${o.x},${o.y}`,
      build: () => (u.channel ? `BUILDING ${u.channel.progress + 1}/${def.build.turns}` : `BUILD (1/${def.build.turns})`),
    }[o.type]?.() ?? o.type;
    return `#${i + 1} ${what}`;
  }

  function renderCard(g) {
    const u = s.playing ? null : selected();
    const pc = $('[data-portrait]');
    const ctx = crispCanvas(pc, 52, 60);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = C.board;
    ctx.fillRect(0, 0, 52, 60);
    if (!u) {
      $('[data-card]').classList.add('empty');
      $('[data-name]').textContent = s.playing ? 'ENEMY & ALLIED MOVES' : level.title.toUpperCase();
      $('[data-stats]').textContent = s.playing ? 'The queue runs, one entry at a time.' : level.goal;
      const mine = game().units.filter((x) => x.team === Teams.PLAYER);
      const ordered = mine.filter((x) => game().entryFor(x.id)).length;
      $('[data-order]').textContent = s.playing ? '' : `ORDERS ${ordered}/${mine.length} · TAP A UNIT`;
      return;
    }
    $('[data-card]').classList.remove('empty');
    const def = getUnitType(u.type);
    // The unit's sprite at 2x (the canvas scales to device pixels), facing right.
    ctx.drawImage(unitSprite(u.type, u.team), 26 - 13 * 1.5, 59 - 40 * 1.5, 26 * 1.5, 40 * 1.5);
    const vip = g.objective?.kind === 'escort' && g.objective.unitId === u.id;
    $('[data-name]').innerHTML = `${esc(def.name.toUpperCase())}${u.team === Teams.CPU ? ' <span class="tag dark">ENEMY</span>' : ''}${vip ? ' <span class="tag">★ ESCORT</span>' : ''}`;
    $('[data-stats]').textContent = statsOf(u);
    const dies = s.preview?.killed.has(u.id);
    $('[data-order]').innerHTML = `${esc(describeOrder(g, u))}${dies ? ' <span class="tag dark">✕ DIES THIS TURN</span>' : ''}`;
  }

  function renderActions() {
    const a = $('[data-actions]');
    const u = s.playing ? null : selected();
    if (!u || u.team !== Teams.PLAYER) {
      a.innerHTML = u
        ? '<p class="note">Enemy unit. Its numbered marker shows when it acts.</p>'
        : '<p class="note">Every queued order is drawn and numbered on the board.</p>';
      return;
    }
    const def = getUnitType(u.type);
    const btns = [
      { id: 'move', label: 'MOVE', on: true },
      { id: 'quick', label: 'ϟ QUICK', on: u.quickMoves > 0 },
    ];
    if (def.attack) btns.push({ id: 'attack', label: def.attack.kind === 'projectile' ? '➶ SHOOT' : '✷ STRIKE', on: true });
    if (def.charge) btns.push({ id: 'charge', label: '» CHARGE', on: u.charges > 0 });
    if (def.teleport) btns.push({ id: 'teleport', label: '⇢ TELEPORT', on: u.teleports !== 0 });
    if (def.build) btns.push({ id: 'build', label: '▣ BUILD', on: !game().buildingAt(u.x, u.y) });
    const has = !!game().entryFor(u.id);
    btns.push({ id: 'cancel', label: '✕', on: has, cls: 'narrow', aria: 'Cancel order' });
    a.innerHTML = btns.map((b) => `<button data-act="${b.id}" class="${b.cls ?? ''} ${s.mode === b.id ? 'active' : ''}" ${b.on ? '' : 'disabled'} ${b.aria ? `aria-label="${b.aria}"` : ''}>${b.label}</button>`).join('');
  }

  // ---- input ---------------------------------------------------------------

  function toast(msg) {
    const t = $('[data-toast]');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(s.toastTimer);
    s.toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function give(order) {
    const u = selected();
    try {
      s.match.playerOrder(u.id, order);
      s.mode = null;
      refresh();
      return true;
    } catch (err) {
      toast(err.message.replace(/^Invalid order: /, '').replace(/^./, (c) => c.toUpperCase()));
      return false;
    }
  }

  function select(u) {
    s.selectedId = u ? u.id : null;
    s.mode = u && u.team === Teams.PLAYER && !game().entryFor(u.id) ? 'move' : null;
    refresh();
  }

  function onTap(sx, sy) {
    if (s.playing) {
      s.speed = 0.25;
      for (const tw of s.tweens) tw.ms *= 0.25;
      return;
    }
    if (s.match.status !== MatchStatus.PLAYING) return;
    const hex = view.pick(sx, sy);
    const g = game();
    const u = selected();
    if (hex && u && u.team === Teams.PLAYER && s.mode) {
      const isReach = (cells) => cells?.some(([x, y]) => x === hex.x && y === hex.y);
      const tapped = g.unitAt(hex.x, hex.y);
      if (s.mode === 'move' || s.mode === 'quick') {
        if (isReach(reach()?.cells)) {
          give(s.mode === 'quick' ? quickMove(hex.x, hex.y) : move(hex.x, hex.y));
          return;
        }
        if (!tapped) {
          toast(`Out of reach: ${getUnitType(u.type).name}s move ${u.speed} hex a turn.`);
          return;
        }
      } else if (s.mode === 'attack' || s.mode === 'charge') {
        if (hex.x === u.x && hex.y === u.y) {
          s.mode = null;
          refresh();
          return;
        }
        const dirs = getUnitType(u.type).attack.directions;
        const dir = nearestDirection((x, y) => view.grid.center(x, y, view.grid.standHeight(x, y)), u, hex.x, hex.y, dirs);
        give(s.mode === 'charge' ? charge(dir) : attack(dir));
        return;
      } else if (s.mode === 'teleport') {
        if (isReach(reach()?.cells)) {
          give(teleport(hex.x, hex.y));
          return;
        }
        if (!tapped) {
          toast('Teleport to a marked hex.');
          return;
        }
      }
    }
    const tapped = hex ? g.unitAt(hex.x, hex.y) : null;
    if (tapped && tapped.id !== s.selectedId) select(tapped);
    else select(null);
  }

  function onAction(id) {
    const u = selected();
    if (!u) return;
    if (id === 'build') {
      give(build());
      return;
    }
    if (id === 'cancel') {
      game().cancelOrder(u.id);
      s.mode = null;
      refresh();
      return;
    }
    s.mode = s.mode === id ? null : id;
    refresh();
  }

  // ---- the turn ------------------------------------------------------------

  async function endTurn() {
    if (s.playing || s.match.status !== MatchStatus.PLAYING) return;
    const before = game().snapshot();
    s.undo = before;
    s.selectedId = null;
    s.mode = null;
    const events = s.match.endTurn();
    await playback(Game.fromSnapshot(before), events);
    afterTurn();
  }

  async function playback(display, events) {
    s.playing = true;
    s.speed = 1;
    s.display = display;
    s.anim = { units: new Map(), hidden: new Set(), bullets: [], effects: [], rising: new Map() };
    s.activeStep = 0;
    $('[data-skip]').hidden = false;
    renderSheet();
    s.dirty = true;
    for (const e of events) {
      if (e.step && e.step !== s.activeStep) {
        s.activeStep = e.step;
        renderQueue(display);
        await wait(170);
      }
      await playEvent(display, e);
    }
    await wait(300);
    s.display = null;
    s.anim = null;
    s.playing = false;
    s.activeStep = 0;
    $('[data-skip]').hidden = true;
  }

  function afterTurn() {
    const st = s.match.status;
    refresh();
    if (st === MatchStatus.PLAYING) {
      stamp(`TURN ${pad2(game().tickCount + 1)}`);
      return;
    }
    if (st === MatchStatus.WON) app.progress.markCleared(level.id);
    showResult(st);
  }

  // Board point helpers for playback.
  // Board points for playback, in art pixels (`lift` is in hex-heights above the ground).
  const standH = (g, x, y) => view.grid.groundHeight(x, y) + (g.buildingAt(x, y) ? BUILDING_HEIGHT : 0);
  const feet = (g, x, y) => view.grid.center(x, y, standH(g, x, y));
  const screenOf = (g, x, y, lift = 0.5) => {
    const [ax, ay] = feet(g, x, y);
    return [ax, ay - Math.round(lift * 30)];
  };

  /** Show an effect for `ms` without waiting for it. */
  function flash(effect, ms) {
    s.anim.effects.push(effect);
    tween(ms, (t) => { effect.t = t; }).then(() => {
      const i = s.anim?.effects.indexOf(effect) ?? -1;
      if (i >= 0) s.anim.effects.splice(i, 1);
    });
  }

  const BLOCKED_TEXT = {
    occupied: 'BLOCKED', 'no route': 'NO ROUTE', 'mine limit': 'MINE LIMIT', 'already built': 'ALREADY BUILT',
  };

  async function playEvent(g, e) {
    const u = e.unitId !== undefined ? g.getUnit(e.unitId) : null;
    switch (e.type) {
      case 'quickMove':
        if (u) flash({ kind: 'text', text: 'ϟ QUICK', ...xy(screenOf(g, u.x, u.y, 1.5)), t: 0 }, 600);
        break;
      case 'charge':
        if (u) flash({ kind: 'text', text: '» CHARGE!', ...xy(screenOf(g, u.x, u.y, 1.5)), t: 0, dark: true }, 600);
        break;
      case 'moved': {
        if (!u) break;
        const fast = g.queue[e.step - 1]?.order?.type === 'charge';
        for (let i = 1; i < e.path.length; i++) {
          const [ax, ay] = e.path[i - 1];
          const [bx, by] = e.path[i];
          const [x0, y0] = feet(g, ax, ay);
          const [x1, y1] = feet(g, bx, by);
          await tween(fast ? 95 : 190, (t) => {
            const hop = fast ? 0 : Math.round(Math.sin(Math.PI * t) * 7);
            s.anim.units.set(u.id, [Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t) - hop]);
          });
          [u.x, u.y] = [bx, by];
        }
        s.anim.units.delete(u.id);
        break;
      }
      case 'blocked':
        if (u) await textAt(g, u, BLOCKED_TEXT[e.reason] ?? 'BLOCKED', 420);
        break;
      case 'attackBlocked':
        if (u) await textAt(g, u, e.reason === 'enemy adjacent' ? 'CAN\'T SHOOT: ENEMY CLOSE' : 'STILL RELOADING', 520);
        break;
      case 'shot': {
        const atk = u ? getUnitType(u.type).attack : null;
        g.state.projectiles.push({ id: e.projectileId, ownerId: e.unitId, x: e.from[0], y: e.from[1], dir: e.dir, speed: atk?.speed ?? 4, range: null, traveled: 0 });
        if (u) flash({ kind: 'text', text: 'BANG', ...xy(screenOf(g, u.x, u.y, 1.4)), t: 0 }, 450);
        await wait(90);
        break;
      }
      case 'projectileMoved': {
        const p = g.getProjectile(e.projectileId);
        if (!p) break;
        const angle = view.dirAngle(p.dir);
        const b = { id: p.id, ax: 0, ay: 0, angle };
        s.anim.bullets.push(b);
        for (let i = 1; i < e.path.length; i++) {
          const [ax, ay] = e.path[i - 1];
          const [bx, by] = e.path[i];
          const [x0, y0] = view.grid.center(ax, ay);
          const [x1, y1] = view.grid.center(bx, by);
          await tween(70, (t) => Object.assign(b, { ax: Math.round(x0 + (x1 - x0) * t), ay: Math.round(y0 + (y1 - y0) * t) - CHEST }));
          [p.x, p.y] = [bx, by];
        }
        s.anim.bullets.splice(s.anim.bullets.indexOf(b), 1);
        break;
      }
      case 'projectileExpired':
        g.state.projectiles = g.state.projectiles.filter((p) => p.id !== e.projectileId);
        break;
      case 'projectileBlocked': {
        g.state.projectiles = g.state.projectiles.filter((p) => p.id !== e.projectileId);
        const [x, y] = screenOf(g, e.at[0], e.at[1], 0.6);
        flash({ kind: 'boom', x, y, size: 0.6, t: 0, seed: e.projectileId }, 300);
        await textAtXY(x, y - 10, 'THUD', 360);
        break;
      }
      case 'strike':
        flash({ kind: 'strike', cells: e.cells, t: 0 }, 320);
        await wait(200);
        break;
      case 'killed': {
        if (e.hits?.[0]?.cause === 'projectile') g.state.projectiles = g.state.projectiles.filter((p) => p.id !== e.hits[0].sourceId);
        const [x, y] = screenOf(g, e.at[0], e.at[1], 0.6);
        flash({ kind: 'boom', x, y, size: 1, t: 0, seed: e.unitId }, 450);
        await wait(220);
        g.state.units = g.state.units.filter((x2) => x2.id !== e.unitId);
        s.anim.units.delete(e.unitId);
        await wait(260);
        break;
      }
      case 'teleported': {
        if (!u) break;
        flash({ kind: 'text', text: 'POOF', ...xy(screenOf(g, u.x, u.y, 0.8)), t: 0 }, 400);
        s.anim.hidden.add(u.id);
        await wait(180);
        [u.x, u.y] = e.to;
        s.anim.hidden.delete(u.id);
        await wait(180);
        break;
      }
      case 'minePlaced':
        g.state.mines.push({ id: e.mineId, x: e.at[0], y: e.at[1], ownerId: e.unitId, team: u?.team ?? Teams.CPU });
        break;
      case 'mineExploded': {
        g.state.mines = g.state.mines.filter((m) => m.id !== e.mineId);
        const [x, y] = screenOf(g, e.at[0], e.at[1], 0.3);
        flash({ kind: 'boom', x, y, size: 1.4, t: 0, seed: e.mineId }, 500);
        flash({ kind: 'text', text: 'BOOM!', x, y: y - 30, t: 0, dark: true }, 600);
        await wait(300);
        break;
      }
      case 'channeling':
        if (u) {
          u.channel = { kind: e.kind, progress: e.progress };
          await textAt(g, u, `BUILDING ${e.progress}/${e.of}`, 450);
        }
        break;
      case 'built': {
        const b = { id: e.buildingId, x: e.at[0], y: e.at[1], team: u?.team ?? Teams.PLAYER, builderId: e.unitId };
        g.state.buildings.push(b);
        if (u) u.channel = null;
        await tween(450, (t) => s.anim.rising.set(b.id, t));
        s.anim.rising.delete(b.id);
        break;
      }
      case 'channelBroken':
        if (u) {
          u.channel = null;
          await textAt(g, u, 'BUILD BROKEN', 450);
        }
        break;
      default:
    }
  }

  const xy = ([x, y]) => ({ x, y });
  function textAt(g, u, text, ms) {
    const [x, y] = screenOf(g, u.x, u.y, 1.5);
    return textAtXY(x, y, text, ms);
  }
  function textAtXY(x, y, text, ms) {
    flash({ kind: 'text', text, x, y, t: 0 }, ms);
    return wait(ms * 0.8);
  }

  // ---- overlays ------------------------------------------------------------

  function stamp(text) {
    const st = $('[data-stamp]');
    st.textContent = text;
    st.classList.remove('show');
    void st.offsetWidth; // restart the animation
    st.classList.add('show');
  }

  function overlay(html) {
    const o = $('[data-overlay]');
    o.innerHTML = '';
    if (!html) {
      o.hidden = true;
      return null;
    }
    o.append(h(html));
    o.hidden = false;
    return o;
  }

  function showResult(st) {
    const won = st === MatchStatus.WON;
    const title = won ? 'MISSION COMPLETE' : st === MatchStatus.DRAW ? 'NO SURVIVORS' : 'MISSION FAILED';
    const sub = won
      ? 'The builder made it across.'
      : game().objective?.kind === 'escort' && !game().getUnit(game().objective.unitId)
        ? 'The builder was lost.'
        : 'Our side was wiped out.';
    const o = overlay(`
      <div class="panel result ${won ? 'won' : 'lost'}">
        <div class="big-stamp">${title}</div>
        <p>${sub}</p>
        <p class="meta">${level.title} · ${game().tickCount} turns</p>
        <div class="col">
          ${won ? '' : '<button data-r="undo">↶ UNDO LAST TURN</button>'}
          <button data-r="retry">RETRY MISSION</button>
          <button class="primary" data-r="campaign">CAMPAIGN ▸</button>
        </div>
      </div>`);
    o.querySelector('[data-r="retry"]').onclick = () => { overlay(null); restart(); };
    o.querySelector('[data-r="campaign"]').onclick = () => app.show('campaign');
    const u = o.querySelector('[data-r="undo"]');
    if (u) u.onclick = () => { overlay(null); undo(); };
  }

  function showMenu() {
    const o = overlay(`
      <div class="panel menu">
        <h2>PAUSED</h2>
        <div class="col">
          <button class="primary" data-m="resume">RESUME</button>
          <button data-m="help">HOW TO PLAY</button>
          <button data-m="restart">RESTART MISSION</button>
          <button data-m="campaign">QUIT TO CAMPAIGN</button>
          <a class="button" href="debug.html">DEBUG BOARD</a>
        </div>
      </div>`);
    o.querySelector('[data-m="resume"]').onclick = () => overlay(null);
    o.querySelector('[data-m="help"]').onclick = showHelp;
    o.querySelector('[data-m="restart"]').onclick = () => { overlay(null); restart(); };
    o.querySelector('[data-m="campaign"]').onclick = () => app.show('campaign');
  }

  function showHelp() {
    const o = overlay(`
      <div class="panel help">
        <h2>HOW TO PLAY</h2>
        <ul>
          <li>The enemy (dark) shows its whole plan. Hatched hexes get hit this turn.</li>
          <li>Every queued order is drawn on the board with its <b>number</b> in the queue; tap a chip (or a unit) to select it.</li>
          <li>End Turn runs the <b>queue</b> left to right; each order finishes before the next.</li>
          <li>Your orders join the end. <b>ϟ Quick</b> moves and <b>» charges</b> jump to the front.</li>
          <li>Whoever gets to a hex first keeps it; the other unit stops.</li>
          <li>Gunslinger shots fly 4 hexes a turn until they hit something. <b>Buildings stop shots.</b></li>
          <li>Gunslingers can't shoot with an enemy next to them. Pikemen strike 2 hexes in a row.</li>
          <li>Stalkers teleport and leave mines. Builders build in 2 turns.</li>
          <li>A <b>✕</b> on a unit means it dies if the turn runs as planned.</li>
          <li>Drag to pan, pinch to zoom.</li>
        </ul>
        <div class="col"><button class="primary" data-h="ok">GOT IT</button></div>
      </div>`);
    o.querySelector('[data-h="ok"]').onclick = () => overlay(null);
  }

  function restart() {
    s.undo = null;
    newMatch(startLevel(level.id));
    stamp('TURN 01');
  }

  function undo() {
    if (!s.undo || s.playing) return;
    const snap = s.undo;
    s.undo = null;
    s.match = new Match(Game.fromSnapshot(snap));
    view.setGame(s.match.game);
    s.selectedId = null;
    s.mode = null;
    refresh();
    stamp(`TURN ${pad2(game().tickCount + 1)}`);
  }

  // ---- wiring --------------------------------------------------------------

  const detach = attachGestures($('canvas'), {
    onTap,
    onPan: (dx, dy) => { view.panBy(dx, dy); s.dirty = true; },
    onZoom: (f, cx, cy) => { view.zoomAt(f, cx, cy); s.dirty = true; },
  });
  $('[data-recenter]').onclick = () => { view.resetCamera(); s.dirty = true; };
  $('[data-menu]').onclick = showMenu;
  $('[data-end]').onclick = endTurn;
  $('[data-undo]').onclick = undo;
  $('[data-actions]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled) onAction(b.dataset.act);
  });
  $('[data-queue]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-chip]');
    if (!b || s.playing) return;
    const u = game().getUnit(Number(b.dataset.chip));
    if (u) select(u);
  });
  const onResize = () => { if (view.resize()) s.dirty = true; };
  window.addEventListener('resize', onResize);

  newMatch(startLevel(level.id));

  return {
    el,
    mounted() {
      view.setGame(game());
      view.resize();
      view.fit();
      s.dirty = true;
      requestAnimationFrame(frame);
      stamp('TURN 01');
    },
    destroy() {
      detach();
      window.removeEventListener('resize', onResize);
    },
    // For tests and the console.
    api: {
      get match() { return s.match; },
      get playing() { return s.playing; },
      get threats() { return s.threats; },
      get view() { return view; },
      select: (id) => select(game().getUnit(id)),
      action: onAction,
      tapHex(x, y) {
        const [sx, sy] = view.artToCss(...view.grid.center(x, y, view.grid.standHeight(x, y)));
        onTap(sx, sy);
      },
      endTurn,
    },
  };
}
