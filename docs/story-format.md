# Compiled story format (v1)

The contract between the compiler and every runtime. A runtime in any language that implements this document can play any Emaki story. Source of truth for types: `packages/format/src/compiled.ts` and `expr.ts`.

## Top level
```jsonc
{
  "format": "emaki-story",
  "version": 1,
  "meta": { "title": "...", "author": "..." },   // free-form strings from the header
  "start": 0,                                   // instruction index to begin at
  "characters": { "mira": { "name": "Mira", "color": "#e8b04b" } },
  "images": { "kitchen": "bg/kitchen.svg", "mira smile": "sprites/mira_smile.svg" },
  "audio": { "rain": "audio/rain.ogg" },
  "achievements": { "first_light": { "name": "First Light" } },  // only when the story has any
  "vars": { "trust": 0, "read_letter": false },  // initial values
  "globals": ["endings_seen"],                   // optional: vars kept across playthroughs (global var)
  "labels": { "arrival": 0, "kitchen_talk": 27 },
  "code": [ /* instructions */ ],
  "hash": "1x9k2p"                              // changes whenever anything above changes
}
```

## Instructions
Every instruction has `op` and `src: { line, label }`. `target` fields are indices into `code`.

| op | fields | blocks? | semantics |
|---|---|---|---|
| `say` | `id, who (char id or null), attrs[], text, spans?` | **yes** | If `attrs` non-empty and `who` is on screen, set its attrs. Interpolate `{var}` (`{{`/`}}` escape) in `text` and in each span. Show line. pc+1. |
| `menu` | `id, choices[{id, text, spans?, cond (expr or null), target}]` | **yes** | Offer choices whose `cond` is truthy (keep original indices). On pick: pc = choice.target. Error if none visible. |
| `wait` | `seconds` | **yes** | Pause. pc+1. |
| `achieve` | `id` | no | Unlock achievement `id` (a key of `achievements`). Unlocking twice is harmless. pc+1. |
| `scene` | `image (name, "black" or null), transition, duration?` | no | Background = image (`black`/null = none); remove all sprites; camera back to the whole picture. `duration` (seconds) only when the script gave one. |
| `show` | `tag, attrs (array or null), at (null, "left"/"center"/"right" or a percentage like "30%"), transition, duration?` | no | If tag not shown: add with attrs (null → image named exactly `tag`, else first image starting with `tag `) at `at` or center. If shown: replace attrs if given, move if `at` given. Image name = `[tag, ...attrs].join(" ")`. For a layered tag see below. |
| `hide` | `tag, transition` | no | Remove sprite if present. |
| `play` | `channel (music/ambience/sound/voice), path, loop, fade` | no | `music`: music state = {path, loop}. `ambience` with `loop`: ambience state = {path}. `sound` with `loop`: looping sound state = {path, loop}. Voices and one-shot sounds aren't state. |
| `stop` | `channel, fade` | no | That channel's state = null (`sound` also stops one-shot sounds still playing). |
| `set` | `name, expr` | no | vars[name] = eval(expr). (`+=`/`-=` are compiled into the expr.) |
| `jump` | `target, label?` | no | pc = target. |
| `jumpIfNot` | `cond, target` | no | pc = truthy(cond) ? pc+1 : target. |
| `call` | `target, label` | no | push pc+1; pc = target. |
| `return` | — | no | pop into pc; if stack empty, the story ends. (Compiler appends one to every label.) |
| `end` | `ending?` | no | Story ends. With `ending` (a key of `endings`), that ending was reached. |
| `nvl` | `mode (on/off/clear)` | no | `on`/`clear`: start an empty page of full-screen text; `off`: back to the text box. Lines shown while a page is open are added to it. |
| `shake` | `duration?` | no | Shake the picture (effect only, no state). |
| `flash` | `color, duration?` | no | Flash the screen in `color` (`white`, `black`, `red` or `#rrggbb`); effect only. |
| `motion` | `motion, target, times?, forever?` | no | The sprite with tag `target` (or the text box, for `textbox`) makes a move: `hop`, `nod`, `bow`, `shake` (side to side) or `float` (slow drift), `times` times (1 when absent). Nothing happens if the sprite isn't on screen. With `forever: true` (sprites only) the move repeats endlessly: the sprite's state gains `loop` = the move, kept until `still`, `hide` or `scene`. |
| `still` | `target` | no | Remove the sprite's `loop` (its endless move stops). |
| `tone` | `tone, duration?` | no | Scene tone = `sepia` or `mono` (`none` removes it): a tint over the picture (not the text), faded over `duration` seconds. Kept by `scene`; saved and rolled back with the scene. |
| `movie` | `path` | yes | Play the video at `path` full screen; the host continues when it ends or the player skips it. Effect only (skipped when skipping or going back). |
| `screen` | `mode (show/hide/call), name, into?` | call: **yes** | `show`: put screen `name` on top of the shown screens (state `screens`, a list, bottom first; moved to the top if already there). `hide`: take it off. pc+1. `call`: show screen `name` and wait until one of its buttons runs a `return` action; then, if `into` is given and the return had a value, vars[into] = that value. pc+1. |
| `camera` | `zoom, x, y, duration?` | no | Scene camera = zoom `zoom` (≥ 1) toward the point `x`%, `y`% of the screen; `zoom 1, x 50, y 50` is the whole picture. Animated over `duration` seconds without blocking. Part of the scene, so saved and rolled back with it. |

**Voices.** `voices` (optional) maps line ids to voice files. When a `say` runs without a `play voice` just before it and its id is in `voices`, play that file on the voice channel as if `play voice` had come first.

**Layered characters.** `layered` maps a tag to its layers, bottom first: `{ path }` is always drawn; `{ group, options: {attr: path}, default }` draws the option currently chosen for the group (`default` until one is chosen; `null` means nothing). For a layered tag, a sprite's attrs are the chosen option per group. Each attr in a `show` or `say` replaces the option of the group that contains it; `-attr` clears that group. With no attrs, a new sprite starts with every group's default.

A runtime should guard against loops that execute many instructions without blocking (reference: 100,000).

## Styled text
`text` is always plain, with markup removed. When a line uses styling, `spans` is also present: an array of `{ text, b?: true, i?: true, color?: string, ruby?: string }` runs that join to make `text`. `ruby` is a reading shown in small type above that run (furigana); runtimes without ruby support show the text alone. Runtimes without styling support can ignore `spans`. `color` is a hex code or a plain colour name, validated by the compiler.

A span with empty `text` and a `pause` marks a pause at that point in a `say` line: `"click"` (wait for the player, `[w]`), a number of seconds (`[w=1.5]`), or `"next"` (`[nw]`, always last: continue to the next line without waiting for the player). Lines with pauses always carry `spans`. A runtime that ignores pauses still shows the right text.

## Screens
`screens` (absent when the game has none) maps a screen name to `{ items: Item[], transition?: "fade" | "dissolve", duration?: number }` (with a transition, the screen fades in over `duration` seconds, 0.3 by default, when it opens). Names `title` and `menu` replace the built-in title menu and the in-game menu, `textbox` the text box; other names are opened by `open`. An item:

```
{ "kind": "image" | "text" | "button" | "row" | "column" | "box"
         | "slots" | "thumbnail" | "gallery" | "endings" | "achievements" | "slider" | "toggle" | "choice"
         | "dialogue" | "speaker" | "side",
  "id"?: "screen.title.1f3a",           // translation id of text (and "<id>.alt" of alt)
  "text"?: "New Game", "spans"?: [...],  // text / button label, as in say
  "image"?: "ui/new.png", "hover"?: "ui/new_on.png", "alt"?: "...",
  "pressed"?, "selected"?, "disabled"?: "ui/...",  // buttons and slots: pictures for those states
  "knob"?: "ui/knob.png",                // a slider with an image (its gauge) and this knob
  "x"?, "y"?: number,                    // percent of the screen's width / height; absent: flows in its parent
  "w"?, "h"?: number,                    // percent of the screen's width / height
  "anchor"?: [ax, ay],                   // the point of the element at x, y, as fractions of its size; default [0, 0]
  "gap"?: number,                        // percent of the screen's height
  "className"?: "heading",
  "count"?: 6, "columns"?: 3,            // slots, gallery: cells per page and across
  "setting"?: "music_volume",            // slider, toggle, choice
  "cond"?: Expr,                         // shown only while truthy
  "actions"?: Action[],                  // buttons
  "children"?: Item[] }                  // row, column, box
```

Actions: `{do:"start", label?}`, `{do:"continue"}`, `{do:"open", screen}`, `{do:"close"}`, `{do:"title"}`, `{do:"quit"}`, `{do:"jump", label}`, `{do:"set", name, op:"="|"+="|"-=", value: Expr}`, `{do:"page", to:"next"|"previous"|number}`, `{do:"return", value?: Expr}` (on a screen the story called: go on with the story, with the value; elsewhere like `close`), `{do:"switch", screen}` (show it in place of the current screen), `{do:"setting", name, value}` (set a player setting; a button with it is selected while the setting holds the value), `{do:"back"}`, `{do:"auto"}`, `{do:"skip"}`, `{do:"hide"}`, `{do:"quicksave"}`, `{do:"quickload"}`, `{do:"voice"}`; on `slots` only, `{do:"load"}` or `{do:"save"}` (what clicking a slot does).

`slots` shows `count` save slots of the current page (`meta.save_slots` in all, default 3); its `children`, if any, are drawn in each slot with the variables `slot_number`, `slot_cell` (its place on the page, from 1), `slot_empty`, `slot_date` and `slot_text` added (picture paths of `slots` can use `{slot_cell}` and `{slot_number}`), and `thumbnail` (only inside `slots`) is the slot's saved scene redrawn. `gallery` shows `count` of `gallery` images per page. Every screen also sees `page` and `pages` for the first `slots` or `gallery` it has. Names `save`, `load`, `settings` and `extras` replace those built-in screens. In `textbox`, `dialogue`, `speaker` and `side` mark where the line, the speaker's name and the side image go, and the variable `speaker` is the speaker's name (`""` for narration); buttons on it replace the quick menu. `meta.click_sound` and `meta.hover_sound` play for screen buttons. An `image` with no `x`, `w` or `h` covers the screen; a placed image without a size is drawn at its natural size relative to `meta.canvas` (default 1920 wide). Pixel values in the script are converted to percentages at compile time.

## Expressions
JSON trees, `k` = kind:
```
{ "k": "num", "v": 1 }      { "k": "str", "v": "a" }     { "k": "bool", "v": true }
{ "k": "var", "name": "trust" }
{ "k": "un",  "op": "-" | "not", "e": Expr }
{ "k": "bin", "op": "+","-","*","/","%","==","!=","<","<=",">",">=","and","or", "l": Expr, "r": Expr }
```
Rules: `+` concatenates if either side is a string, else numbers only. `- * / %` numbers only; division/modulo by zero is an error. `== !=` strict equality (no coercion). `< <= > >=` require both numbers or both strings. `and`/`or` short-circuit and return booleans. Truthiness: `false`, `0`, `""` are falsy.

## Conformance
`packages/runtime/test/runner.test.ts` is the de-facto conformance suite: the demo story's four playthroughs and the mechanics tests. A future runtime should pass equivalent tests (plan: export them as JSON fixtures: story + inputs → expected block sequence).

## Translations
A translation is a separate JSON document the runtime can load next to the story:
```jsonc
{
  "format": "emaki-translation", "version": 1, "lang": "fr",
  "strings": { "arrival.1k2j3": { "text": "Vous êtes en avance.", "spans": [ /* optional, as above */ ] },
               "ui.start": { "text": "Commencer" }, "achievement.first_light": { "text": "Première lumière" } },
  "names": { "mira": "Mira" },          // character id -> name
  "meta": { "title": "Le Gardien" }
}
```
Keys of `strings` are the `id`s of `say` instructions and menu choices, plus `achievement.<id>` and the player's own `ui.*` texts. A runtime shows `strings[id]` instead of the original when present (interpolating `{var}` as usual), and the original otherwise.
