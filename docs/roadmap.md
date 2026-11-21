# Roadmap

Emaki hasn't had a release yet. This page is about what comes next. For what's already built, see the [changelog](../CHANGELOG.md), and for why things work the way they do, the [decisions log](decisions.md).

Most of what's here came from trying to make real games in Emaki and hitting a wall (D-035). If you hit one too, open an issue: that's the best way to move something up this list.

## Done so far

- **0. Walking skeleton:** the `.vn` language, compiler, headless runtime, web player and a demo game with three endings.
- **1. The core loop:** story map, formatter, line previews, text styling, settings, accessibility fonts and the VS Code extension.
- **2. The editor:** script, live game and flowchart side by side, with visual scene editing and an asset browser.
- **3. Shipping:** desktop (with Steam), Android and iOS exports, translations, NVL mode, extras, multi-file stories.
- **4. Expressive scenes:** moves, camera, layered characters, voices, gapless loops, side images.
- **5. Multilingual games:** pictures and movies per language, playing movies, endless moves, colour tones, furigana.
- **6–7. Screens:** custom title, menus, text box, save and load, settings, history and confirmation screens.
- **8. Plugins:** commands, screen elements, functions in expressions, variables, storage and types.
- **9. Extras:** scene replay and a music room.
- **10. Long games:** tuned on an 80,000-line game until the dev server, editor and VS Code stayed quick.
- **11. Free layers:** composed shots with stacked, transformed, blended and graded images.
- **12. Workspaces:** Write, Stage and Story in one editor.
- **14. Ren'Py import:** `emaki import renpy` converts a project's scripts and pictures.

## In progress: Emaki Studio

Writers should be able to start without installing Node, git or opening a terminal (D-068). The Windows app and installer work. Still to do:

- [ ] macOS and Linux packages, built in CI on release tags
- [ ] Signed installers and automatic updates
- [ ] Starter templates in New project
- [ ] A check for what Android and iOS exports need (SDK, Java 21, a Mac for iOS) before an export starts, rather than partway through it
- [ ] Recording the engine version in each game

## Next: the rest of the Ren'Py importer

`emaki import renpy` handles scripts and pictures today (D-072). Two pieces are left:

- [ ] Ren'Py translations (`game/tl/`) converted to `lang/*.po`
- [ ] Ren'Py screens converted to Emaki `screen` blocks, where they're simple enough. Anything that relies on Python stays as a comment, the way the script importer does it now.

## Later

No particular order. Most of these wait until a game needs them.

- A native player for consoles, reading the same compiled format (D-005)
- Live2D and Spine, as plugins
- Encrypted packs for every export, not only the Windows player (D-067), and leak watermarking
- Opt-in analytics, built on plugin events
- Plural forms in translations
- Explicit line ids (`#id`) for lines a writer wants to pin (D-008)
- Loading very long stories in parts (D-061)
- Rebinding keys as a player setting (D-063)
- A browser playground with nothing to install (D-068)
