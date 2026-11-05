// The single-player campaign: the level list (src/data/campaign.json) and
// saved progress.
//
// A level is { id, title, scenario, goal, brief, tips }, where `scenario`
// names a board in src/scenarios.js. A level is open once the one before it
// is cleared. Progress lives in localStorage; if that's unavailable (private
// mode, blocked storage) it's kept in memory for the session.

import data from '../data/campaign.json' with { type: 'json' };
import { scenarios } from '../scenarios.js';

export const CAMPAIGN = data;
export const LEVELS = data.levels;

const KEY = 'craft.progress.v1';

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
