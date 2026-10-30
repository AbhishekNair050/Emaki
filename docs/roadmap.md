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

## ▶ Milestone 4 — Expressive scenes (next)
What a finished commercial VN does on screen and in the ear that Emaki can't yet.
- [ ] Movement and effects: slide characters between positions (`show mira at right with move 0.6`), screen shake and flash, zoom and pan on backgrounds and CGs
- [ ] Layered sprites: a character built from body, outfit and face layers, so 3 outfits × 12 expressions don't need 36 images
- [ ] Pauses and pacing inside a line: wait for a click mid-line, timed pauses, a line that advances by itself
- [ ] Voice by convention: voice files found by line id or speaker, so a voiced game doesn't need a `play voice` line before every line; voice replay from the history log
- [ ] Audio polish: gapless music loops (Web Audio) and an ambience channel that plays under music
- [ ] Characters' side images (a portrait in the text box) and per-character text box styling
- [ ] The editor shows the game as players see it: the game's `theme.css`, NVL pages and the scripted title in the preview pane

## ⏸ On hold
- Ren'Py importer (common subset)
- Plugin API v1

## Later
Live2D/Spine plugins, analytics (opt-in), encrypted bundles + leak watermarking, native player for consoles, plural forms in translations, explicit line ids, inline (end-of-line) comments.
