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

## ▶ Milestone 1 — Make the core loop delightful (next)
- [ ] **Flowchart view** (read-only first): render the story graph in the browser next to the player; click a node → jump there
- [ ] Comments preserved by the printer (blocker for any tool that writes .vn files)
- [ ] Jump-to-line preview: `?line=52` starts the story at that line with chosen variable values
- [ ] Text styling: `*italic*`, `**bold**`, colour tags
- [ ] Settings screen: text speed, auto speed, volume, font size, dyslexia-friendly font
- [ ] Portrait phone layout (currently letterboxed tiny)
- [ ] Preload images for the next scene
- [ ] VS Code extension: syntax highlighting + diagnostics (reuse the compiler)
- [ ] Demo: add music/ambience (CC0) to exercise audio

## Milestone 2 — The editor (the differentiator)
- [ ] Editor app (web): script pane + flowchart pane + live player pane
- [ ] Editing in the flowchart writes clean text via the printer (round-trip)
- [ ] Asset browser (drag an image in → `image` line generated)

## Milestone 3 — Ship games
- [ ] Desktop export (Electron/Tauri) + Steamworks plugin
- [ ] Android/iOS export (Capacitor)
- [ ] Localization: export/import strings by line id (PO/CSV), language switcher
- [ ] Ren'Py importer (common subset)
- [ ] Plugin API v1

## Later
Layered sprites, Live2D/Spine plugins, NVL mode, achievements, analytics (opt-in), encrypted bundles + leak watermarking, native player for consoles.
