// The campaign level list and saved progress (src/app/campaign.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, Progress, startLevel, getLevel } from '../src/app/campaign.js';
import { scenarios } from '../src/scenarios.js';
import { Match, MatchStatus } from '../src/match.js';

class MemoryStorage {
  constructor(init = {}) { this.items = { ...init }; }
  getItem(k) { return k in this.items ? this.items[k] : null; }
  setItem(k, v) { this.items[k] = String(v); }
}

test('every level names a real scenario and starts a playable match', () => {
  assert.ok(LEVELS.length >= 1);
  const ids = new Set();
  for (const l of LEVELS) {
    assert.ok(!ids.has(l.id), `duplicate level id ${l.id}`);
    ids.add(l.id);
    assert.ok(scenarios[l.scenario], `${l.id}: unknown scenario ${l.scenario}`);
    for (const k of ['title', 'goal', 'brief']) assert.equal(typeof l[k], 'string', `${l.id}.${k}`);
    const m = new Match(startLevel(l.id));
    assert.equal(m.status, MatchStatus.PLAYING);
  }
  assert.equal(getLevel('escort-1').scenario, 'Escort the builder');
  assert.throws(() => startLevel('nope'), /No level/);
});

test('progress: the first level is open; clearing one is saved', () => {
  const storage = new MemoryStorage();
  const p = new Progress(storage);
  const first = LEVELS[0].id;
  assert.equal(p.isOpen(first), true);
  assert.equal(p.isCleared(first), false);
  assert.equal(p.next.id, first);
  p.markCleared(first);
  p.markCleared(first);
  assert.deepEqual(JSON.parse(storage.getItem('craft.progress.v1')), { cleared: [first] });
  const again = new Progress(storage);
  assert.equal(again.isCleared(first), true, 'loaded from storage');
  if (LEVELS[1]) assert.equal(again.isOpen(LEVELS[1].id), true, 'the next level opens');
  again.reset();
  assert.equal(new Progress(storage).isCleared(first), false);
});

test('progress survives broken or missing storage', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const p = new Progress(broken);
  assert.doesNotThrow(() => p.markCleared(LEVELS[0].id));
  assert.equal(p.isCleared(LEVELS[0].id), true, 'kept in memory');
  const junk = new Progress(new MemoryStorage({ 'craft.progress.v1': '{not json' }));
  assert.deepEqual(junk.data, { cleared: [] });
  const none = new Progress(null);
  assert.equal(none.isOpen(LEVELS[0].id), true);
  assert.equal(none.isOpen('nope'), false);
});
