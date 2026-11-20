# Changelog

Notable changes to Emaki. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); version numbers will follow [Semantic Versioning](https://semver.org/) from the first release. Until 1.0, the script language and the compiled format may change between minor versions; each change is explained in [docs/decisions.md](docs/decisions.md).

## [Unreleased]

The first public version. Everything below is new.

### Writing
- The `.vn` script: a header, characters, images, audio, variables, and labels with dialogue, narration, choices (with conditions), `if`/`elif`/`else`, `jump`/`call`/`return`, endings and achievements. Stories can be split across files.
- Comments on their own line or at the end of any line; the formatter keeps them.
- Friendly, line-numbered errors with "did you mean" suggestions; unreachable scenes are warned about.
- Scenes: backgrounds, characters with expressions, layered characters (outfits × faces), side portraits, positions, transitions with lengths, character moves (`hop`, `nod`, `bow`, `shake`, endless `float`), camera zoom and pan, `shake`, `flash`, colour tones, movies.
- Free layers for composed shots: any image placed at a point, anchored, zoomed, turned, faded, stacked by depth and blended (`add`, `multiply`, `screen`...); `animate` moves them along eased curves, and `animation` blocks give keyed and looping moves; `clip` with `feather` makes letterboxes and panels; `with dissolve` on its own line shows several changes through one transition. Colour grades (`grade dusk: gamma ... levels ... tint ...`), silhouettes, brightness, contrast and blur on any layer; wipes through a rule picture (`with wipe rule_13 0.8`); `textbox hide` for shots meant to be seen whole.
- Sound: music with fades, crossfades and gapless loops, ambience loops (several at once, by name), sound effects, and voice acting by convention (`voice:` in the header) with a recording script from `emaki voices`.
- Text: bold, italic, colours, ruby (furigana), pauses inside a line, `{variables}`, and full-screen text (NVL mode).
- `global var` for values kept across playthroughs.

### Your game's look
- Header keys and `theme.css` for the built-in screens, or a scripted `label title`.
- `screen` blocks for your own title, menu, text box, save and load, settings, history and confirmation screens, and screens shown or called during the story. Layout in percentages or pixels on your art's canvas; picture buttons with hover, pressed, selected and disabled states; picture sliders; tabs; click and hover sounds; fades.
- Extras: CG gallery, scene replay, music room, endings and achievements, unlocked by playing and remembered across playthroughs.

### For players
- Saves with thumbnails and pages, quick save and load, rollback, a history log with voice replay and rewind, auto mode, skip (read text or all), skip to the next choice and back to the previous one. A save from an earlier version of a game opens at the same line, even when lines were added before it.
- Esc and right-click open the menu during the story; a game can give each its own action instead (`escape:` / `right_click:`: save to an empty slot, quick save, hide the interface, settings, history).
- Settings: text speed, auto speed, master, music, sound and voice volume with mutes, per-character voice volume, text size, text box opacity, reading fonts (Atkinson Hyperlegible, OpenDyslexic), animations, language, and which questions to confirm.
- Keyboard, mouse, touch and gamepad; screen-reader support; reduced motion respected; a portrait layout for phones held upright.

### Translation
- `emaki strings` writes PO or CSV catalogs by line id and keeps them up to date, marking changed lines for review. The interface is translatable too.
- Pictures and movies with a version per language (`cg/sign.fr.png`); devices matched by language and script.

### Tools
- A local project launcher (`npm run launch`) in the editor's look: recent projects with their pictures, each project's size and problems (worked out in the background), create/open games with a folder browser, the editor opened in a chosen workspace, player sessions, and web/desktop/Android/iOS exports with build output. Direct `emaki edit <game>` and `emaki play <game>` commands also accept a game folder without environment variables.
- The web editor (`npm run edit`): script, live game and flowchart linked together, visual scene editing written back as clean text, an asset browser with drag and drop, autosave with conflict detection.
- Editor workspaces (D-065): Write, Stage and Story (Alt+1/2/3) in one layout: the scenes and a route chooser on the left, an inspector on the right, the scene's lines along the bottom. A route to an ending, found by playing the story in the background, sets the variables for every play-from-here. Stage has Move / Scale / Rotate tools and guides; Story colours scenes by playtest coverage, words or a variable's value, with a card for each scene, and pans and zooms like a design tool. Route to and the inspector can be hidden; the lines along the bottom follow the game as it plays.
- The VS Code extension: highlighting, errors as you type, completion, go to definition, references, hover, outline, formatting, and play from the cursor's line.
- The dev server with live reload at the same line, a story map for jumping anywhere and testing routes, and previews from any line with chosen variables.
- The CLI: `new`, `check`, `fmt`, `graph`, `build`, `strings`, `voices`, `export`.
- The editor, dev server and launcher listen only on this computer and refuse requests from other sites, including through DNS rebinding (requests are only answered for localhost or an IP address; Vite's `server.allowedHosts` adds names).

### Plugins
- Game plugins in `plugins/<name>/` (a `plugin.json` manifest and JavaScript): commands (effects, lasting effects that survive saves and rollback, and commands the story waits on with a result), screen elements, functions in expressions, and events. The compiler, editor and VS Code check every use against the manifest.
- Plugins can change the story variables their manifest lists (`"sets"`, `ctx.set`), with saves and rollback handled, and keep their own data on the device (`ctx.storage`).
- `emaki plugin <game> <name> [--ts]` starts a plugin. Games with plugins get the plugin API's types (`plugins/emaki-plugin.d.ts`) for completion and checking in JavaScript or TypeScript.

### Long games
- Tested on a full-length game (80,000 lines in 758 files, 31,000 assets): story files are packed (D-059), the player fetches the story as `game.json` (D-060), and edits recompile only what changed, so the dev server, the editor and VS Code stay quick at that size.

### Shipping
- `emaki export web` for itch.io or any host; `desktop` for Windows, macOS and Linux (Electron) with optional Steam achievements; `android` and `ios` projects (Capacitor).
- Desktop windows open in the game's shape (`aspect:`): 960×720 for a 4:3 game instead of 1280×720 with black bars at the sides, in both the Electron and WebView2 shells.
- Windows x64 games export with a small WebView2 player by default (D-067): about 5 MB instead of about 300 MB, with the game's files in an encrypted, tamper-checked pack. It behaves like the Electron app (window size, full screen, display scaling, one copy at a time) and imports saves from an earlier Electron release. Steam games and other systems use Electron; `--shell electron|webview2` chooses.

### Examples
- *The Keeper of Gullwing Point*, a short original story with three endings, two replayable scenes and a music room.
- A plugin demo with three example plugins: weather, a memory minigame and a meter.
