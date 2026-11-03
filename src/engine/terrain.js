// Terrain type registry, loaded from JSON (src/data/terrain.json).
//
// Every hex on the board has a terrain type. Adding a terrain type is a
// JSON-only change. File format:
//
//   {
//     "default": "grass",               type used for hexes not given one
//     "types": {
//       "<key>": {
//         "name":     "Grass",           display name                  (required)
//         "char":     ".",               one character for map strings (required, unique)
//         "color":    "#22331f",         fill colour, CSS hex           (required)
//         "walkable": true               can units stand on / enter it? (required)
//       }
//     }
//   }
//
// Terrain rules today: units can't stand on or move into terrain that isn't
// walkable (e.g. water). Projectiles and melee strikes ignore terrain.
//
// Maps can be written as one string per row, one character per hex, using
// each type's "char", e.g. "..==~~..".

import data from '../data/terrain.json' with { type: 'json' };

/** Registered terrain types by key (frozen, validated definitions). */
export const TerrainTypes = {};
export let DEFAULT_TERRAIN = null;
const byChar = new Map();

export function getTerrainType(key) {
  const def = TerrainTypes[key];
  if (!def) throw new Error(`Unknown terrain type "${key}"`);
  return def;
}

/** Terrain key for a map character, or throws. */
export function terrainForChar(ch) {
  const key = byChar.get(ch);
  if (!key) throw new Error(`Unknown terrain character "${ch}" (known: ${[...byChar.keys()].join(' ')})`);
  return key;
}

export function defineTerrainType(key, raw) {
  const fail = (msg) => { throw new Error(`Terrain type "${key}": ${msg}`); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('must be an object');
  for (const k of Object.keys(raw)) {
    if (!['name', 'char', 'color', 'walkable'].includes(k)) fail(`unknown field "${k}" (allowed: name, char, color, walkable)`);
  }
  if (typeof raw.name !== 'string' || !raw.name) fail('"name" must be a non-empty string');
  if (typeof raw.char !== 'string' || [...raw.char].length !== 1) fail('"char" must be a single character');
  if (typeof raw.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(raw.color)) fail('"color" must look like "#22331f"');
  if (typeof raw.walkable !== 'boolean') fail('"walkable" must be true or false');
  return Object.freeze({ key, name: raw.name, char: raw.char, color: raw.color, walkable: raw.walkable });
}

/**
 * Validate a terrain file and register its types (replacing same keys).
 * Everything is checked before the registry changes.
 */
export function registerTerrainTypes(json) {
  if (!json || typeof json !== 'object' || !json.types || typeof json.types !== 'object') {
    throw new Error('Terrain file must have a "types" object');
  }
  const defs = Object.entries(json.types).map(([key, raw]) => defineTerrainType(key, raw));
  const merged = { ...TerrainTypes };
  for (const d of defs) merged[d.key] = d;
  const chars = new Map();
  for (const d of Object.values(merged)) {
    if (chars.has(d.char)) throw new Error(`Terrain types "${chars.get(d.char)}" and "${d.key}" share the character "${d.char}"`);
    chars.set(d.char, d.key);
  }
  const def = json.default ?? DEFAULT_TERRAIN;
  if (!merged[def]) throw new Error(`Default terrain type "${def}" is not defined`);
  if (!merged[def].walkable) throw new Error(`Default terrain type "${def}" must be walkable`);

  Object.assign(TerrainTypes, merged);
  byChar.clear();
  for (const [ch, key] of chars) byChar.set(ch, key);
  DEFAULT_TERRAIN = def;
}

registerTerrainTypes(data);
