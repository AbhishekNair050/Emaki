# Changelog

Notable changes to Emaki. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); version numbers will follow [Semantic Versioning](https://semver.org/) from the first release. Until 1.0, the script language and the compiled format may change between minor versions; each change is explained in [docs/decisions.md](docs/decisions.md).

## [Unreleased]

The first public version. Everything below is new.

### Writing
- The `.vn` script: a header, characters, images, audio, variables, and labels with dialogue, narration, choices (with conditions), `if`/`elif`/`else`, `jump`/`call`/`return`, endings and achievements. Stories can be split across files.
- Comments on their own line or at the end of any line; the formatter keeps them.
- Friendly, line-numbered errors with "did you mean" suggestions; unreachable scenes are warned about.
- Scenes: backgrounds, characters with expressions, layered characters (outfits × faces), side portraits, positions, transitions with lengths, character moves (`hop`, `nod`, `bow`, `shake`, endless `float`), camera zoom and pan, `shake`, `flash`, colour tones, movies.
- Free layers for composed shots: any image placed at a point, anchored, zoomed, turned, faded, stacked by depth and blended (`add`, `multiply`, `screen`...); `animate` moves them along eased curves, and `animation` blocks give keyed and looping moves; `clip` with `feather` makes letterboxes and panels; `with dissolve` on its own line shows several changes through one transition. Colour grades (`grade dusk: gamma ... levels ... tint ...`), silhouettes, brightness, contrast and blur on any layer.
- Sound: music with fades, crossfades and gapless loops, an ambience channel, sound effects, and voice acting by convention (`voice:` in the header) with a recording script from `emaki voices`.
- Text: bold, italic, colours, ruby (furigana), pauses inside a line, `{variables}`, and full-screen text (NVL mode).
- `global var` for values kept across playthroughs.

### Your game's look
- Header keys and `theme.css` for the built-in screens, or a scripted `label title`.
- `screen` blocks for your own title, menu, text box, save and load, settings, history and confirmation screens, and screens shown or called during the story. Layout in percentages or pixels on your art's canvas; picture buttons with hover, pressed, selected and disabled states; picture sliders; tabs; click and hover sounds; fades.
- Extras: CG gallery, scene replay, music room, endings and achievements, unlocked by playing and remembered across playthroughs.

### For players
- Saves with thumbnails and pages, quick save and load, rollback, a history log with voice replay and rewind, auto mode, skip (read text or all), skip to the next choice and back to the previous one.
- Esc and right-click open the menu during the story; a game can give each its own action instead (`escape:` / `right_click:`: save to an empty slot, quick save, hide the interface, settings, history).
- Settings: text speed, auto speed, master, music, sound and voice volume with mutes, per-character voice volume, text size, text box opacity, reading fonts (Atkinson Hyperlegible, OpenDyslexic), animations, language, and which questions to confirm.
- Keyboard, mouse, touch and gamepad; screen-reader support; reduced motion respected; a portrait layout for phones held upright.

### Translation
- `emaki strings` writes PO or CSV catalogs by line id and keeps them up to date, marking changed lines for review. The interface is translatable too.
- Pictures and movies with a version per language (`cg/sign.fr.png`); devices matched by language and script.

### Tools
- The web editor (`npm run edit`): script, live game and flowchart linked together, visual scene editing written back as clean text, an asset browser with drag and drop, autosave with conflict detection.
- The VS Code extension: highlighting, errors as you type, completion, go to definition, references, hover, outline, formatting, and play from the cursor's line.
- The dev server with live reload at the same line, a story map for jumping anywhere and testing routes, and previews from any line with chosen variables.
- The CLI: `new`, `check`, `fmt`, `graph`, `build`, `strings`, `voices`, `export`.

### Plugins
- Game plugins in `plugins/<name>/` (a `plugin.json` manifest and JavaScript): commands (effects, lasting effects that survive saves and rollback, and commands the story waits on with a result), screen elements, functions in expressions, and events. The compiler, editor and VS Code check every use against the manifest.

### Long games
- Tested on a full-length game (80,000 lines in 758 files, 31,000 assets): story files are packed (D-059), the player fetches the story as `game.json` (D-060), and edits recompile only what changed, so the dev server, the editor and VS Code stay quick at that size.

### Shipping
- `emaki export web` for itch.io or any host; `desktop` for Windows, macOS and Linux (Electron) with optional Steam achievements; `android` and `ios` projects (Capacitor).

### Examples
- *The Keeper of Gullwing Point*, a short original story with three endings, two replayable scenes and a music room.
- A plugin demo with three example plugins: weather, a memory minigame and a meter.
