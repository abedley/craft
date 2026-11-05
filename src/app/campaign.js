// The single-player campaign: the level list (src/data/campaign.json) and
// saved progress.
//
// A level is { id, title, scenario, goal, brief, tips }, where `scenario`
// names a board in src/scenarios.js. A level is open once the one before it
// is cleared. Progress lives in localStorage; if that's unavailable (private
// mode, blocked storage) it's kept in memory for the session.
//
// The battle in progress is autosaved too (BattleSave): one slot holding the
// level id, a Game snapshot taken as each turn starts (the CPU's plan already
// staged), and the undo snapshot. The game resumes it when it opens.

import data from '../data/campaign.json' with { type: 'json' };
import { scenarios } from '../scenarios.js';
import { Game } from '../engine/game.js';

export const CAMPAIGN = data;
export const LEVELS = data.levels;

const KEY = 'craft.progress.v1';
const BATTLE_KEY = 'craft.battle.v1';

export function getLevel(id) {
  return LEVELS.find((l) => l.id === id) ?? null;
}

/** A fresh Game for a level. */
export function startLevel(id) {
  const level = getLevel(id);
  if (!level) throw new Error(`No level "${id}"`);
  const make = scenarios[level.scenario];
  if (!make) throw new Error(`Level "${id}" uses unknown scenario "${level.scenario}"`);
  return make();
}

export class Progress {
  /** @param {Storage|null} [storage] defaults to localStorage when it works */
  constructor(storage = defaultStorage()) {
    this.storage = storage;
    this.data = { cleared: [] };
    try {
      const raw = storage?.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && Array.isArray(parsed.cleared)) this.data = { cleared: parsed.cleared.filter((x) => typeof x === 'string') };
    } catch {
      // Unreadable save: start fresh.
    }
  }

  isCleared(id) {
    return this.data.cleared.includes(id);
  }

  /** The first level is always open; each later one once the one before is cleared. */
  isOpen(id) {
    const i = LEVELS.findIndex((l) => l.id === id);
    if (i < 0) return false;
    return i === 0 || this.isCleared(LEVELS[i - 1].id);
  }

  /** The first open level not cleared yet (or the last level). */
  get next() {
    return LEVELS.find((l) => this.isOpen(l.id) && !this.isCleared(l.id)) ?? LEVELS[LEVELS.length - 1];
  }

  markCleared(id) {
    if (!this.isCleared(id)) this.data.cleared.push(id);
    this.save();
  }

  reset() {
    this.data = { cleared: [] };
    this.save();
  }

  save() {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Storage full or blocked: progress lasts for this session only.
    }
  }
}

export class BattleSave {
  /** @param {Storage|null} [storage] defaults to localStorage when it works */
  constructor(storage = defaultStorage()) {
    this.storage = storage;
    this.data = null; // { levelId, game, undo } with raw snapshots
    try {
      const raw = storage?.getItem(BATTLE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && getLevel(parsed.levelId) && parsed.game && typeof parsed.game === 'object') {
        // Make sure it still loads with this version of the rules.
        Game.fromSnapshot(parsed.game);
        if (parsed.undo) Game.fromSnapshot(parsed.undo);
        this.data = { levelId: parsed.levelId, game: parsed.game, undo: parsed.undo ?? null };
      }
    } catch {
      // Unreadable or outdated save: drop it.
      this.data = null;
    }
  }

  /** The level id of the saved battle, or null. */
  get levelId() {
    return this.data?.levelId ?? null;
  }

  /** The saved battle for a level as { game, undo } (a fresh Game; undo is a snapshot or null), or null. */
  load(levelId) {
    if (!this.data || this.data.levelId !== levelId) return null;
    try {
      return { game: Game.fromSnapshot(this.data.game), undo: this.data.undo ? structuredClone(this.data.undo) : null };
    } catch {
      return null;
    }
  }

  /** Save a battle (replaces any other). `undo` is a snapshot or null. */
  save(levelId, game, undo = null) {
    this.data = { levelId, game: game.snapshot(), undo: undo ? structuredClone(undo) : null };
    try {
      this.storage?.setItem(BATTLE_KEY, JSON.stringify(this.data));
    } catch {
      // Storage full or blocked: the save lasts for this session only.
    }
  }

  clear() {
    this.data = null;
    try {
      this.storage?.removeItem(BATTLE_KEY);
    } catch {
      // Blocked: nothing to remove.
    }
  }
}

function defaultStorage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    s.getItem(KEY);
    return s;
  } catch {
    return null;
  }
}
