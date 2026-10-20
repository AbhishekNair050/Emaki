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

## ▶ Milestone 2 — The editor (the differentiator, next)
- [x] Editor app (web): script pane + flowchart pane + live player pane, linked both ways; edits show in the running game at once; autosave with conflict detection (`npm run edit`)
- [ ] Editing in the flowchart writes clean text via the printer (round-trip)
- [ ] Asset browser (drag an image in → `image` line generated)

## Milestone 3 — Ship games
- [ ] Desktop export (Electron/Tauri) + Steamworks plugin
- [ ] Android/iOS export (Capacitor)
- [ ] Localization: export/import strings by line id (PO/CSV), language switcher
- [ ] Ren'Py importer (common subset)
- [ ] Plugin API v1

## Later
Gapless music loops (Web Audio), an ambience channel that plays under music, layered sprites, Live2D/Spine plugins, NVL mode, achievements, analytics (opt-in), encrypted bundles + leak watermarking, native player for consoles.
