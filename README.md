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
  orders.js           order constructors + validation (move, attack)
  resolve.js          simultaneous move / collision resolution
src/data/units.json   unit definitions (add new units here)
src/match.js          turn structure: CPU stages orders, player orders, end turn
src/ai/cpu.js         deterministic CPU opponent
src/ui/               canvas renderer + debug controls
src/scenarios.js      preset boards that exercise collision rules
test/                 node:test suites for the engine
```

## Turns and teams

**The CPU's plan is visible, and that is a core mechanic:** the CPU commits to its orders first and you
see all of them (pink lines, shot rays and strike zones, plus the Queue tab) before you decide.

The game is played by two teams: the player (blue) and the CPU (pink). Every unit has a `team`
(`'player'` default, or `'cpu'`). **Friendly fire is on**: projectiles hit whatever unit is in their way.

Each turn (`src/match.js`):

1. **The CPU stages all of its orders first** (`match.startTurn()`), looking only at the board as it
   stands. Its orders go to the front of the queue, so under the "first ordered wins" rule the CPU wins
   same-instant ties for a cell.
2. The player stages orders for their own units (`match.playerOrder()`); the CPU's plan is fixed.
   The player cannot order CPU units.
3. **End turn** (`match.endTurn()`) runs one tick, then the CPU stages the next turn.

`match.status` is `playing`, `won` (no CPU units left), `lost` (no player units left) or `draw` (both
wiped out in the same tick). Boards with no CPU units are sandboxes and never end.

### CPU (`src/ai/cpu.js`)

Deterministic: same board, same plan. For each CPU unit in id order:

1. **Dodge** an incoming projectile that would reach it within two ticks with nothing in between, if
   it can still step out of the line in time.
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

## Engine model

- The world is a `width x height` hex grid; each hex holds at most one unit.
- Every unit has a **type** (`src/engine/unitTypes.js`) that defines its speed, which orders it
  accepts, and what it fires. Ordering a unit to do something its type can't do throws.
- During a turn the player queues orders (`game.queueOrder(unitId, move(x, y))`,
  `game.queueOrder(unitId, attack('down'))`). Nothing changes until `game.tick()`.
  If a unit gets several orders in one turn, only the last is carried out.
- `tick()`:
  1. applies queued orders in queue order (see *Combat* for `attack`),
  2. moves units in timed **sub-steps** (see *Speed* below); at each sub-step every unit
     due to step moves one hex toward its target along a straight hex line (always a shortest
     path, never off the board; no pathfinding around units yet) and those steps are resolved
     **simultaneously**,
  3. units that reached their target drop their order.
  It returns an event list (`orderApplied`, `moved` with the full `path`, `blocked` with the
  sub-step `time` it first happened, `arrived`, `shot`, `strike`, `projectileMoved`, `killed`,
  `projectileExpired`).
- Move orders persist across ticks until the unit arrives or gets a new order.
  A blocked unit simply tries again next tick.

### Speed

Each unit has a `speed` (cells per tick, 1–6, default 1): `new Game({ units: [{ x, y, speed: 3 }] })`,
`game.addUnit(x, y, id, { speed })`, `game.setSpeed(id, speed)`.

A unit with speed *s* takes one step at times 1/s, 2/s, …, 1 within the tick. The engine walks
through every distinct step time in order (exactly, using integer math over the lcm of all
speeds). At each instant, the units stepping then are resolved together with the
single-step collision rules below, while everyone else stands still and holds their cell. So:

- "Who got there first" means real arrival time within the tick: a speed-3 unit reaching a cell at
  t=2/3 keeps it against a speed-1 unit arriving at t=1, regardless of order age.
- Units arriving at the *same* instant use the normal contest rule (first ordered wins).
- No unit can jump over or pass through another; a fast unit stuck behind a slow one moves at the
  slow one's pace.
- A blocked unit retries at its own next step time within the same tick.

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
| `speed` | cells per tick, 1–6 (required) |
| `shape` | `circle` (default), `diamond`, `square`, `triangle` |
| `attack` | leave it out for a unit that can't attack |
| `attack.kind` | `melee` or `projectile` |
| `attack.directions` | `all` (the 6 hex directions), `vertical` (up/down), or a list like `["up", "down-left"]` |
| `attack.reach` | melee: how many hexes in a row it strikes |
| `attack.speed` | projectile: cells per tick, 1–6 |
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
limited to what the type allows). The unit holds
still that tick and any move order is cancelled. What happens depends on its `attack.kind`.

**Melee** (pikeman):

- Strikes at the **end of the tick** (t = 1). Every unit in the `reach` hexes in a straight line next to it
  in that direction dies, teammates included.
- Because it lands at the end, a unit that steps out of the zone during the tick escapes, and a unit
  that walks into it is hit. Combined with the visible CPU plan, you can dodge a CPU strike or aim yours
  where a CPU unit is heading.
- It happens at the same instant as any projectile hits at t = 1: a striker shot at t = 1 still strikes,
  but one killed earlier in the tick doesn't. Two pikemen striking each other both die.

**Projectile** (gunslinger):

- The projectile spawns in the shooter's cell at the start of the tick.
- Projectiles are on the same sub-step timeline as units (a speed-4 projectile steps at
  t = ¼, ½, ¾, 1). They fly straight, never steer, are never blocked, don't block units, and keep
  going across ticks until they hit something, leave the grid, or pass their `range` (if set).
- At each instant, after units and projectiles have stepped, a projectile **hits** a unit if they
  share a cell (except a projectile still sitting in its shooter's cell), or if they passed
  through each other that instant. The unit is **killed and removed immediately**, freeing its cell for
  the rest of the tick, and the projectile is used up. Only the first unit in the line is hit.
- Same instant means same outcome for everyone: two gunslingers shooting each other both die.
  Projectiles don't collide with each other.

### Collision rules (`src/engine/resolve.js`)

Guiding rule: **whoever got to a cell first keeps it, and the colliding unit doesn't move.**

1. **Contested cell** – several units step into the same empty cell on the same tick: the unit
   whose move order was given first wins (orders are stamped with a sequence number when applied;
   unit id breaks exact ties). The rest don't move.
2. **Swap** – two units try to trade cells: both stay.
3. **Occupied** – a unit standing in a cell keeps it. A unit can enter an occupied cell only if its occupant leaves this tick.
   Propagated to a fixed point, so a line of units moves together if its front is free and
   stops together if not.
4. **Rotation** – closed loops of 3+ units all move.

### Determinism

The engine uses no randomness, clock, or DOM; units are processed in id order; state is
plain JSON. `game.hash()` is an FNV-1a hash of canonical JSON state, shown in the debug
UI header, so two runs with the same orders can be compared at a glance.
`game.snapshot()` / `Game.fromSnapshot()` give exact save/restore.

## Debug UI

- Starts on **Skirmish vs CPU**. CPU orders are already staged when your turn starts (pink dashed
  lines, listed first in the Queue tab); tap **End turn** when your orders are in. The header shows
  YOU WIN / YOU LOSE / DRAW when a side is wiped out.
- **Move** mode: tap one of your units to select it, tap an empty cell to queue `move(x, y)`.
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
- Tabs: queued orders, per-tick event log, unit list, and raw state JSON (copy / edit / load).
- `window.debug.game` is available in the browser console.

## Deploying

`.github/workflows/pages.yml` runs the tests and deploys on every push to `main`.
One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
