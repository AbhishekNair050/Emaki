# Plugins

Emaki scripts never contain code (D-005). When a game needs something the script language doesn't do, like falling snow, a minigame or a meter on the screen, the game ships a **plugin**: a little JavaScript, described by a manifest so the compiler can check every use of it before the game runs.

`games/plugin-demo` is a small game using three example plugins; copy them as starting points.

## Using a plugin

```
label start:
  scene cliff
  @weather start kind="petals" amount=60      # an effect that lasts
  mira: Want to play a game?
  @memory play pairs=4 -> turns               # the story waits; the result goes in turns
  mira: {turns} turns!
  @weather stop

screen hud:
  @meter bar value=trust max=10 label="Trust" at 3% 8% size 20% 2%
```

- A line starting with `@` runs a plugin's command: `@plugin command name=value ...`. Arguments are always named. A value is a number, a quoted string, `true`/`false`, a variable, or an expression with no spaces (`amount=base*2`).
- `-> variable` keeps the result of a command the story waits on (a minigame's score).
- In a screen, `@plugin element name=value ...` places one of the plugin's elements, with the usual `at`, `size`, `anchor`, `class=` and `if`. Variables in its arguments are read each time the screen is drawn.
- The compiler checks every `@` line against the plugin's manifest: the plugin and command exist, every argument is one it takes, required ones are there, and written values have the right type. `emaki check`, the dev server, the editor and exports all do this.

## Writing a plugin

A plugin is a folder `plugins/<name>/` in the game, with two files. The name is lowercase letters, digits and `_`, and is what scripts write after `@`.

### plugin.json: what scripts can write

```json
{
  "description": "Falling snow, rain or petals over the scene.",
  "commands": {
    "start": { "args": { "kind": ["snow", "rain", "petals"], "amount": "number?" }, "lasting": "sky" },
    "stop": { "lasting": "sky", "ends": true }
  },
  "elements": {
    "bar": { "args": { "value": "number", "max": "number?" } }
  }
}
```

| Key | Meaning |
|---|---|
| `commands` / `elements` | What `@name ...` can run in a story, and place in a screen. |
| `args` | Each argument's type: `"number"`, `"string"`, `"boolean"` (add `?` if it can be left out), or a list of the strings it may be. |
| `waits` | The story waits until the command finishes (its promise resolves); `-> variable` keeps the result. |
| `lasting` | The command's effect lasts, and is part of the saved game under this slot: loading, going back and line previews redo it. A later command with the same slot replaces it. |
| `ends` | The command clears its `lasting` slot (snow stops). |
| `main` | The code file, if not `index.js`. |

### index.js: what it does

The default export is a function that gets a **context** and returns the plugin:

```js
export default function weather(ctx) {
  const canvas = document.createElement('canvas');
  ctx.layer.append(canvas);
  return {
    commands: {
      start(args, run) { /* draw args.kind; run.instant: show the end state at once */ },
      stop() { /* clear */ },
    },
    reset() { /* forget every lasting effect: a new game, a load, going back */ },
  };
}
```

| The context | |
|---|---|
| `layer` | The plugin's own layer: over the characters, under the text box. Clicks pass through it. |
| `stage` | The whole stage (for its size). |
| `modal()` | `{ root, close() }`: a full-screen area over the story that takes clicks, for a command the story waits on. The player closes it if the player goes back or loads. |
| `asset(path)` | URL of a file in the game's assets/ (in the player's language when it has a version). Files in the plugin's own folder: `new URL('./petal.png', import.meta.url)`. |
| `vars()` | The story's variables, read-only. Plugins change the story only through results (`-> variable`). |
| `reducedMotion` | True when the player asked for less motion: keep effects still or subtle. |
| `volume(channel)`, `playSound(path)` | The volume `music`, `sound` or `voice` plays at now (master volume and mutes included), and a sound at the sound effects volume. |
| `language` | The language shown (null for the one the game is written in). |

| The plugin | |
|---|---|
| `commands` | By name: `(args, run) => void`, or a promise for a command the story waits on (what it resolves to is the result). `run.instant` is true when skipping or redoing a lasting command, `run.restoring` when redoing one. |
| `elements` | By name: `(args) => HTMLElement`, placed by the screen. Called again each time the screen is drawn. |
| `on` | Events: `start()`, `title()`, `line({ id, speaker, text, label })`, `choice({ id, text })`, `ending({ id, name })`, `achievement({ id, name })`, `save()`, `load()`. For analytics, a Discord status, achievements elsewhere. |
| `reset()` | Forget every lasting effect. The player calls it before redoing the lasting commands after a load, going back or a line preview, and when a new game starts. |
| `destroy()` | The player is going away. |

**Lasting effects come back by being run again.** A plugin doesn't save anything itself: the story keeps each lasting command and its arguments, and after a load the player calls `reset()` and runs them again with `run.restoring` set. So a lasting command should draw its whole state from its arguments.

**A broken plugin doesn't break the game.** Errors are logged to the console; a command the story waits on that fails lets the story go on without a result.

**Trust.** A plugin is code the game's author put in the game, with the same trust as the game itself; there is no sandbox. Don't add plugins you haven't read.

**Builds.** Exports bundle each plugin's code (and whatever it imports) into the game; nothing else is needed.
