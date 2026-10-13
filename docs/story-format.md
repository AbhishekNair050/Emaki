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
  "vars": { "trust": 0, "read_letter": false },  // initial values
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
| `scene` | `image (name, "black" or null), transition` | no | Background = image (`black`/null = none); remove all sprites. |
| `show` | `tag, attrs (array or null), at (null/"left"/"center"/"right"), transition` | no | If tag not shown: add with attrs (null → image named exactly `tag`, else first image starting with `tag `) at `at` or center. If shown: replace attrs if given, move if `at` given. Image name = `[tag, ...attrs].join(" ")`. |
| `hide` | `tag, transition` | no | Remove sprite if present. |
| `play` | `channel (music/sound/voice), path, loop, fade` | no | Music state = {path, loop}. |
| `stop` | `channel, fade` | no | Music state = null for `music`. |
| `set` | `name, expr` | no | vars[name] = eval(expr). (`+=`/`-=` are compiled into the expr.) |
| `jump` | `target, label?` | no | pc = target. |
| `jumpIfNot` | `cond, target` | no | pc = truthy(cond) ? pc+1 : target. |
| `call` | `target, label` | no | push pc+1; pc = target. |
| `return` | — | no | pop into pc; if stack empty, the story ends. (Compiler appends one to every label.) |
| `end` | — | no | Story ends. |

A runtime should guard against loops that execute many instructions without blocking (reference: 100,000).

## Styled text
`text` is always plain, with markup removed. When a line uses styling, `spans` is also present: an array of `{ text, b?: true, i?: true, color?: string }` runs that join to make `text`. Runtimes without styling support can ignore `spans`. `color` is a hex code or a plain colour name, validated by the compiler.

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
