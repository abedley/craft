# Craft

A single-player, turn-based hex-grid game for the mobile browser (built for an
iPhone 13 Pro held vertically), hosted on GitHub Pages.

No build step: plain ES modules served as static files.

## Run locally

```sh
npm run serve        # http://localhost:8000
npm test             # engine unit tests (Node 20+)
```

To try it on a phone, serve on your LAN and open `http://<your-ip>:8000`.

## Layout

```
index.html            debug UI shell
css/style.css         mobile-first styles (safe areas, 44px touch targets)
src/engine/           deterministic game engine (no DOM)
  game.js             Game state, order queue, tick(), projectiles
  hex.js              hex grid geometry (directions, distance, lines)
  unitTypes.js        loads + validates unit definitions from JSON
  terrain.js          loads + validates terrain definitions from JSON
  orders.js           order constructors + validation (move, attack)
src/data/units.json   unit definitions (add new units here)
src/data/terrain.json terrain definitions (add new terrain here)
src/match.js          turn structure: CPU stages orders, player orders, end turn
src/ai/cpu.js         deterministic CPU opponent
src/ui/               canvas renderer + debug controls
src/scenarios.js      preset boards: matches and rule demos
test/                 node:test suites for the engine
```

## Turns and teams

**The CPU's plan is visible, and that is a core mechanic:** the CPU commits to its orders first and you
see all of them (pink lines, shot rays and strike zones, plus the Queue tab) before you decide.

The game is played by two teams: the player (blue) and the CPU (pink). Every unit has a `team`
(`'player'` default, or `'cpu'`). **Friendly fire is on**: projectiles hit whatever unit is in their way.

Each turn (`src/match.js`):

1. **The CPU stages all of its orders first** (`match.startTurn()`), looking only at the board as it
   stands. Its new orders go ahead of the player's in the queue (see *The queue* below), so they
   happen first.
2. The player stages orders for their own units (`match.playerOrder()`); the CPU's plan is fixed.
   The player cannot order CPU units.
3. **End turn** (`match.endTurn()`) runs the queue, then the CPU stages the next turn.

### Quick move

Each of the player's units has **one quick move per match** (`quickMove(x, y)`; CPU units have none).
It's a move order that goes to the **very front of the queue**, so it happens before anything else
that turn, including the CPU's orders and shots still in flight. That's how it **saves a unit from a
gunslinger shot that would land this turn**: the unit has stepped off the shot's line before the
shot is fired. A normal move comes after the CPU's orders, too late. Stepping along the shot's
line doesn't help; you have to step off it. If the walk isn't finished, it carries over to later
turns as an ordinary walk.

- It's only used up when the turn runs. Replacing it with another order or clearing it first
  costs nothing.
- A unit has at most one queued order; queueing a new one replaces the old one.
- `unit.quickMoves` holds how many are left. The `quickMove` event reports when one is spent.

`match.status` is `playing`, `won` (no CPU units left), `lost` (no player units left) or `draw` (both
wiped out in the same tick). Boards with no CPU units are sandboxes and never end.

### CPU (`src/ai/cpu.js`)

Deterministic: same board, same plan. For each CPU unit in id order:

1. **Dodge**: step off the line of a shot in flight that would hit it on the flight *after* next.
   (A shot that hits on its next flight can't be outrun: it's carried over ahead of the CPU's moves,
   and the CPU has no quick moves.)
2. **Attack**:
   - Projectile units shoot if the first unit in an allowed direction, within range, is an enemy
     (nearest first), and never when a teammate is first in line.
   - Melee units strike in the allowed direction that catches the most enemies, as the board stands
     now. They never strike when a teammate stands in the strike, or is planned (earlier in the CPU's own plan)
     to step into it.
3. **Move**: projectile units head for the nearest free cell with a clear, in-range shot at an enemy;
   everyone else walks toward the nearest enemy.

All of this reads from the unit definitions, so JSON-only units are played sensibly too.

## Hex grid

The board is a rectangle of **flat-topped hexes** (`src/engine/hex.js`), default 8 × 8. Positions are
`(x, y)` = (column, row), and odd columns sit half a hex lower ("odd-q" layout). Each hex has six
neighbours and six directions: `up`, `up-right`, `down-right`, `down`, `down-left`, `up-left`. There is
no straight left/right. Straight lines run through opposite sides, so a **column is a straight
up/down line**, which suits teams facing each other from the top and bottom of a portrait phone.

Distances are hex steps. Internally the geometry uses axial coordinates; `step`, `distance`,
`neighbors` and `hexLineStep` are exported for other code. Saved states are tagged `grid: 'hex'`, and
square-grid saves from earlier versions are rejected with a clear error.

## Terrain

Every hex has a terrain type, defined in **`src/data/terrain.json`** (validated on load, like units):

```json
{
  "default": "grass",
  "types": {
    "grass":  { "name": "Grass",  "char": ".", "color": "#22331f", "walkable": true },
    "road":   { "name": "Road",   "char": "=", "color": "#4a3f30", "walkable": true },
    "forest": { "name": "Forest", "char": "f", "color": "#16261a", "walkable": true },
    "sand":   { "name": "Sand",   "char": "s", "color": "#4d4630", "walkable": true },
    "water":  { "name": "Water",  "char": "~", "color": "#173450", "walkable": false }
  }
}
```

**The only terrain rule so far: units can't stand on or move into a hex that isn't `walkable`
(water).** Placing a unit there or ordering a move onto it is rejected. Projectiles and melee strikes
ignore terrain: you can shoot across a river.

- **Pathfinding:** units walk the shortest route around unwalkable hexes. Among equally short routes
  they prefer the straight hex line, so in open ground they walk straight. Other units are not
  avoided: a unit stops when its next hex is occupied (see *The queue*). With no route at all, a unit
  stays put.
- **Maps:** pass `terrain` to `new Game` as one string per row, one `char` per hex, e.g.
  `'~=~~~~=~'`. Omit it for all-default. `game.terrainAt(x, y)`, `game.isWalkable(x, y)` and
  `game.setTerrain(x, y, type)` read and edit it (you can't make an occupied hex unwalkable).
- **Saves:** terrain is part of the saved state and the state hash.
- **CPU:** "nearest" means walking distance, and gunslingers only pick firing hexes they can stand on
  and reach.
- **Adding a terrain type** is a JSON-only change. New *rules* (e.g. movement cost, cover) need code.

## The queue (engine model)

**The order queue decides everything.** When a turn runs (`game.tick()`), the queue is carried out
front to back, and **each entry happens in full before the next one starts**, on the board exactly
as the entries before it left it. There are no hidden phases or simultaneous moves: whatever is
earlier in the queue happens first.

**Queue order** each turn:

1. **Quick moves** (the player's one-time "go first" moves)
2. **Carried over from last turn**: shots still in flight and walks not yet finished, in the order
   they ran
3. **The CPU's new orders** (it stages its plan first)
4. **The player's new orders**

A unit has at most one entry; giving it a new order replaces the old one, including a carried-over
walk (the new order goes where new orders go).

**What each entry does when its turn comes:**

- **Move** (`move(x, y)`): the unit walks up to its `speed` in hexes along a shortest walkable route
  (straight hex line where possible; see *Terrain*). If the next hex is occupied, it stops there:
  whoever is in the hex got there first. If it hasn't arrived, the order carries over to next turn.
- **Attack** (`attack(dir)`): see *Combat*. The unit doesn't move that turn.
- **Projectile in flight**: flies another `speed` hexes (see *Combat*).

So, for example: two units heading for the same hex, the one earlier in the queue gets it; two units
trying to swap places both stay put; a line of units walks together only if the front unit is
first in the queue; a fast unit gains distance, not priority.

Events from `tick()` (`orderStarted`, `moved` with the full `path`, `blocked`, `arrived`, `shot`,
`projectileMoved`, `strike`, `killed`, `projectileExpired`, `quickMove`) all carry `step`, the
queue position that caused them. `game.orderFor(id)` returns a unit's queued order; carried-over
entries are marked `carried: true`.

Other basics: the world is a `width x height` hex grid; each hex holds at most one unit. Every unit
has a **type** that defines its speed and attack; ordering a unit to do something its type can't do
throws.

### Unit types (defined in JSON)

Unit types live in **`src/data/units.json`**. Adding a unit is a JSON-only change: the engine, CPU,
renderer and debug UI all read behaviour from the definition, and the file is validated on load with
error messages that name the unit and field.

```json
{
  "default": "pikeman",
  "units": {
    "pikeman": {
      "name": "Pikeman", "speed": 1, "shape": "circle",
      "attack": { "kind": "melee", "reach": 2, "directions": "all" }
    },
    "gunslinger": {
      "name": "Gunslinger", "speed": 1, "shape": "diamond",
      "attack": { "kind": "projectile", "speed": 4, "directions": "all" }
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `name` | display name (required) |
| `speed` | hexes walked per move entry, 1–6 (required) |
| `shape` | `circle` (default), `diamond`, `square`, `triangle` |
| `attack` | leave it out for a unit that can't attack |
| `attack.kind` | `melee` or `projectile` |
| `attack.directions` | `all` (the 6 hex directions), `vertical` (up/down), or a list like `["up", "down-left"]` |
| `attack.reach` | melee: how many hexes in a row it strikes |
| `attack.speed` | projectile: hexes flown per queue entry, 1–6 |
| `attack.range` | projectile: max cells travelled; leave it out for unlimited |
| `default` | type used when a unit doesn't name one |
| `renamed` | optional: old type keys mapped to current ones, so old saves still load |

Example: a range-limited archer that only shoots along one diagonal line, which needs no code:

```json
"archer": {
  "name": "Archer", "speed": 1, "shape": "triangle",
  "attack": { "kind": "projectile", "speed": 2, "range": 3, "directions": ["down-right", "up-left"] }
}
```

Only a brand-new attack *kind* (e.g. an area blast) needs code: in `unitTypes.js` (validation),
`game.js` (resolution), `ai/cpu.js` (CPU use) and `ui/renderer.js` (drawing the queued attack).
`registerUnitTypes(json)` can also add types at runtime, as `test/units.test.js` does.

A unit's speed starts at its type's speed; `speed` / `setSpeed` override it for debugging and tests.

### Combat

Every attacking unit uses the same order, `attack(dir)` (`dir`: one of the 6 hex directions,
limited to what the type allows). What happens when the entry runs depends on `attack.kind`:

**Melee** (pikeman): every unit in the `reach` hexes in a straight line next to the attacker is
killed, right then, teammates included. A unit that stepped away earlier in the queue escapes; one
that walks in later is safe. A pikeman killed earlier in the queue never strikes.

**Projectile** (gunslinger): a shot is fired from the unit's hex and immediately flies up to its
`speed` (4) hexes in a straight line. It kills the **first unit it meets** and is used up. If it
doesn't hit anything, it stays in flight: it gets an entry in the carried-over part of next turn's
queue and flies another 4 hexes then. It ends when it leaves the board or passes its `range` (if
set). Shots fly over any terrain, never steer, don't block units, and don't collide with each
other. A unit that walks into a hex where a shot is sitting is hit.

So two gunslingers facing each other within 4 hexes: the one first in the queue wins, and the other
never fires.

### Determinism

The engine uses no randomness, clock, or DOM; the queue fixes the order of everything; state is
plain JSON. `game.hash()` is an FNV-1a hash of canonical JSON state, shown in the debug
UI header, so two runs with the same orders can be compared at a glance.
`game.snapshot()` / `Game.fromSnapshot()` give exact save/restore.

## Debug UI

- Starts on **Skirmish vs CPU** (a river with two bridges; **Open field vs CPU** has no terrain). CPU orders are already staged when your turn starts (pink dashed
  lines, listed first in the Queue tab); tap **End turn** when your orders are in. The header shows
  YOU WIN / YOU LOSE / DRAW when a side is wiped out.
- **Move** mode: tap one of your units to select it, tap an empty cell to queue `move(x, y)`.
- **Paint** mode: pick a terrain type and tap or drag across hexes to paint it. The CPU re-plans
  afterwards.
- **Quick** mode: the same, but queues that unit's one-time quick move (drawn in cyan, listed first in
  the queue). Units that still have their quick move show a small lightning pip.
- **Attack** mode: tap one of your units, then tap any cell or unit to attack toward it, snapped to the
  nearest direction that unit's type allows. Queued melee attacks shade the
  struck cells in the team's colour.
- **Add** / **Remove** modes edit the board (the CPU re-plans after edits). The type and team pickers
  set what gets added.
  Gunslingers are drawn as diamonds, pikemen as circles.
- **Speed** sets the selected unit's speed, or the speed for newly added units when none is selected.
  Units faster than 1 show their speed in a small badge.
- Projectiles are orange dots with a tail. Queued shots show as a dotted orange ray.
- **End turn** resolves the turn, **Back** restores the state just before the last End turn (both sides'
  orders included), **Auto** ends turns until the match is over or everything is idle.
- **Clear** removes your queued orders (the CPU's stay).
- **Preview** draws green arrows along next tick's full unit paths, orange arrows for projectiles,
  a red X on units that will be killed, and dashed red rings on units that will be blocked.
- **Scenario** loads preset collision cases.
- Tabs: the queue in run order (quick / continuing / CPU / your new orders, and shots in flight), a
  per-turn event log numbered by queue step, unit list, and raw state JSON (copy / edit / load).
- `window.debug.game` is available in the browser console.

## Deploying

`.github/workflows/pages.yml` runs the tests and deploys on every push to `main`.
One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
