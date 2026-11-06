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
| `camera` | `zoom, x, y, duration?` | no | Scene camera = zoom `zoom` (≥ 1) toward the point `x`%, `y`% of the screen; `zoom 1, x 50, y 50` is the whole picture. Animated over `duration` seconds without blocking. Part of the scene, so saved and rolled back with it. |

**Voices.** `voices` (optional) maps line ids to voice files. When a `say` runs without a `play voice` just before it and its id is in `voices`, play that file on the voice channel as if `play voice` had come first.

**Layered characters.** `layered` maps a tag to its layers, bottom first: `{ path }` is always drawn; `{ group, options: {attr: path}, default }` draws the option currently chosen for the group (`default` until one is chosen; `null` means nothing). For a layered tag, a sprite's attrs are the chosen option per group. Each attr in a `show` or `say` replaces the option of the group that contains it; `-attr` clears that group. With no attrs, a new sprite starts with every group's default.

A runtime should guard against loops that execute many instructions without blocking (reference: 100,000).

## Styled text
`text` is always plain, with markup removed. When a line uses styling, `spans` is also present: an array of `{ text, b?: true, i?: true, color?: string, ruby?: string }` runs that join to make `text`. `ruby` is a reading shown in small type above that run (furigana); runtimes without ruby support show the text alone. Runtimes without styling support can ignore `spans`. `color` is a hex code or a plain colour name, validated by the compiler.

A span with empty `text` and a `pause` marks a pause at that point in a `say` line: `"click"` (wait for the player, `[w]`), a number of seconds (`[w=1.5]`), or `"next"` (`[nw]`, always last: continue to the next line without waiting for the player). Lines with pauses always carry `spans`. A runtime that ignores pauses still shows the right text.

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
