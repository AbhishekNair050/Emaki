# Roadmap

What is done and what comes next.

## ✅ Milestone 0 — Walking skeleton (done, 2026-11-13)
- `.vn` parser with friendly, line-numbered diagnostics and "did you mean" suggestions
- Expression language (sandboxed, portable)
- Compiler → portable JSON format; reference checks; unreachable-label warnings; stable line ids
- Printer (AST → canonical text) with round-trip tests — foundation for the visual editor
- Story graph → Mermaid (`emaki graph`)
- Headless runtime: effects/blocks, call/return, conditions, menus with conditional choices, rollback, save/load, live-reload resume
- Web player: title screen, typewriter text, transitions, sprites, back/log/auto/skip/save/load, keyboard + screen-reader support, reduced motion, letterboxed 16:9
- Dev server with live reload that resumes at the same line; error page for broken scripts
- Demo VN with 3 endings + generated placeholder art; 32 tests

## ✅ Milestone 1 — Make the core loop delightful (done, 2026-11-14)
- [x] **Story map** (dev panel): flowchart of every scene beside the game, current scene highlighted, visited scenes tracked, click a scene to play from it, live-editable variables for testing routes
- [x] Comments and blank lines preserved by the formatter (`emaki fmt`, `--check` in CI)
- [x] Jump-to-line preview: `?line=52&trust=2` starts the story at that line with chosen variable values; Ctrl+Alt+Enter in VS Code opens it beside the script
- [x] Text styling: `*italic*`, `**bold**`, `[color=...]`, with escapes and friendly errors
- [x] Settings screen: text speed (incl. instant), auto-advance wait, music/sound volume, text size, text box opacity, font, animations; saved per game
- [x] Bundled accessibility fonts: Atkinson Hyperlegible and OpenDyslexic (OFL), downloaded only when chosen
- [x] Portrait phone layout: the stage fills the screen when held upright; landscape stays 16:9
- [x] Preload images for the next scene (every branch a few lines ahead; transitions wait briefly for slow images)
- [x] VS Code extension: highlighting, live diagnostics, go to definition, references, hover, completion, outline, formatting (reuses the compiler)
- [x] Demo soundtrack (CC0, credited in `games/gullwing/assets/audio/CREDITS.md`); music fades and crossfades; no sound-effect bursts when skipping or rolling back

## ✅ Milestone 2 — The editor (done, 2026-11-14)
- [x] Editor app (web): script pane + flowchart pane + live player pane, linked both ways; edits show in the running game at once; autosave with conflict detection (`npm run edit`)
- [x] Editing in the flowchart writes clean text via the printer (round-trip): add, rename, delete and connect scenes (a second connection turns a jump into a choice); every edit is undoable in the script
- [x] Asset browser: thumbnails and audio preview; drag an asset onto the script → `image`/`audio` line declared and `scene`/`show`/`play` placed where it was dropped; drop files from the computer to add them to the game

## ✅ Milestone 3 — Ship games (done, 2026-11-14)
- [x] Desktop export (Electron; D-029) for Windows, macOS and Linux + Steamworks: achievements and overlay (D-030); `achievement`/`achieve` in the language
- [x] Android/iOS export (Capacitor; D-031): generated native projects kept between exports, debug APK when the Android SDK is present, back button and full screen on phones
- [x] Localization (D-028): `emaki strings` writes PO or CSV catalogs by line id (with review suggestions for edited lines), the game loads `lang/`, and players switch language at any time; the interface is translatable too
- [x] Lessons from porting a full existing VN (D-035): `aspect: 4:3`, real sound/voice channels with voice volume, `at 30%` positions, `global var`, `narration: plain`
- [x] Skip read text only (default) or all text (D-032)
- [x] Title screen customization (D-033): header keys, `theme.css`, and a scripted `label title`
- [x] Stories split across files (D-034), in the CLI, dev server, editor and VS Code
- [x] NVL mode: `nvl on` / `nvl off` / `nvl clear`, pages that turn over by themselves (D-036)
- [x] Extras screen: CG gallery (`image ... gallery`), endings (`ending` + `end id`), achievements (D-037)
- [x] Transition lengths: `scene beach with dissolve 1.5`

## ✅ Milestone 4 — Expressive scenes (done, 2026-11-14)
What a finished commercial VN does on screen and in the ear that Emaki couldn't yet.
- [x] Movement and effects: `show mira at right with move`, `shake`, `flash red`, and a `camera` that zooms and pans (D-038)
- [x] Layered characters: `layered mira:` with `always` layers and `group`s of options, so outfits and expressions combine (D-039)
- [x] Pauses inside a line: `[w]` waits for a click, `[w=1.5]` for seconds, `[nw]` moves on by itself
- [x] Voice by convention: header `voice: voice/{speaker}/{id}.ogg`, `emaki voices` for the recording script, replay from the history log (D-040)
- [x] Gapless music loops through Web Audio, and an `ambience` channel under the music (D-041)
- [x] Side images (`image side mira smile`) and per-character text boxes through `theme.css` (D-042)
- [x] The editor's game pane uses the game's `theme.css` (updated live) and its voice files; NVL pages and the scripted title already showed there

## 🚧 Milestone 5 — Lessons from a multilingual commercial port (in progress)
Porting a commercial VN demo released in Japanese, English and both Chinese scripts.
- [x] Pictures and movies with a version per language (`cg/sign.fr.png`, D-043); Chinese devices matched by script (`zh-TW` → `zh-Hant`)
- [x] Character and text box moves: `hop`, `nod`, `bow`, `shake mira` (D-044)
- [x] Movies: `movie "movie/opening.mp4"`, skippable (D-045)
- [x] Endless moves: `float icon`, `shake mira forever`, `still mira` (D-046)
- [x] Colour tones on the picture: `tone sepia`, `tone mono`, `tone none` (D-047)
- [x] Ruby text (furigana): `[ruby=うすくれない]薄紅[/ruby]` (D-048)

## ✅ Milestone 6 — Screens
A game can replace any built-in screen with its own, written in the script and styled with `theme.css`, so it looks like itself. Proof: the commercial demo port gets its original title, menu, save/load, settings and text box back.
- [x] Screen language (D-049): `screen name:` with images, text, buttons, rows, columns and boxes; placed by percentages, or by pixels on a declared `canvas: 1920x1080`; `if` on any element; actions `start`, `continue`, `open`, `close`, `title`, `quit`, `jump`, `set`. Replaces the title screen and the game menu
- [x] Data screens (D-050): save/load slots with thumbnails and pages, settings sliders and toggles, the Extras gallery and endings
- [x] Screens during the story (D-051): `show screen`, `hide screen`, `call screen pick_place` with the choice in a variable (maps, phones, calendars)
- [x] The text box as a screen (D-052): name plate, dialogue, side image, its own buttons in place of the quick menu, box art; quick save and load
- [x] Polish (D-053): pressed, selected and disabled pictures, settings as picture buttons, picture sliders, tabs (`switch`), click and hover sounds, fading screens, gamepad navigation, live preview in the editor
- [x] Proof: the port's title, text box, save, load and settings pages, generated from the original layout tables

## ✅ Milestone 7 — Finishing touches for commercial UIs
What the port still drew as dead art, made real.
- [x] The history screen of your own: `screen history`, `log` with replay and go back to a line (D-054)
- [x] Questions in your own art: `screen confirm`, and a setting per question to stop asking
- [x] Master volume, mutes, and each character's voice volume and mute; sample buttons
- [x] Reset settings; skip to the next choice and back to the previous one

## ✅ Milestone 8 — Plugins
- [x] Plugin API v1 (D-055): `plugins/<name>/` with plugin.json + index.js; `@name command key=value [-> var]` commands (effects, lasting, waiting with a result) and `@name element` in screens, checked by the compiler; events; bundled into exports. Example plugins in games/plugin-demo: weather, a memory minigame, a meter
- [ ] Later: functions in expressions, VS Code checks against the game's manifests, completion of plugin commands and arguments

## ✅ Milestone 9 — Scene replay and music room
- [x] `replay label "Name" [image ...] [until label]`: replay scenes from Extras, unlocked once reached, no saving, back to Extras at the end (D-056)
- [x] `audio ... music "Title"`: a music room of the tracks heard so far; `scenes` and `music` elements for a game's own Extras screen, Scenes and Music tabs in the built-in one
- [x] The demo game has two replayable scenes and three tracks; the port has its music room

## ⏸ On hold
- Ren'Py importer (common subset)

## Later
Live2D/Spine plugins, analytics (opt-in), encrypted bundles + leak watermarking, native player for consoles, plural forms in translations, explicit line ids, inline (end-of-line) comments.
