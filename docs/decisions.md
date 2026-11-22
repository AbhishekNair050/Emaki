# Design decisions

Why Emaki works the way it does. Each entry is a choice we made, the reasons for it, and what it costs. Code comments cite entries by number (`D-029`), so numbers never change: when we revisit a decision, the old entry gets an amendment note or is marked superseded, and the new one takes the next number.

An entry is in effect unless it's marked *provisional* (expect to revisit), *superseded*, or *proposed* (written down, not built).

| Area | Entries |
|---|---|
| Project | 001 name, 002 license, 003 TypeScript, 004 no build step, 035 features come from real games |
| Script language | 006 syntax, 007 expressions, 008 line ids, 011 sprite attributes, 012 and 057 comments, 015 trivia, 016 styling, 034 multiple files, 048 furigana |
| Format and runtime | 005 compiled format, 009 headless VM, 019 preloading, 021 line previews, 059 packed files, 060 game.json, 061 loading in parts |
| Player | 010 DOM renderer, 017 settings, 018 stage layout, 022 fonts, 023 audio, 024 reduced motion, 032 skip, 036 NVL, 038 camera, 039 layered characters, 040 voices, 041 loops, 042 side images, 044 moves, 045 movies, 046 endless moves, 047 tones, 062 free layers, 063 Esc and right-click, 069 orientation |
| Screens and extras | 033 title screen, 037 extras, 049 screens, 050 data screens, 051 story screens, 052 text box, 053 picture states, 054 history and confirm, 056 replay and music room |
| Translation | 028 catalogs, 043 translated pictures |
| Editor and tools | 013 story map, 014 flowchart layout, 020 language module, 025 editor, 026 visual edits, 027 dropped assets, 064 launcher, 065 workspaces, 068 Studio, 072 Ren'Py import |
| Plugins | 055 plugins, 058 functions, 066 variables, storage and types |
| Shipping | 029 Electron, 030 Steam, 031 phones, 067 WebView2, 070 and 071 compression |

---

## D-001: The name is Emaki

*Emaki* (絵巻, "picture scroll", said eh-MAH-kee) are Japanese illustrated handscrolls, made from the 12th century on. You read them scene by scene as the scroll unrolls, pictures and words together, which makes them a distant ancestor of the visual novel.

The name is short, rare in software, and works everywhere we need it: the CLI (`emaki`), the package scope (`@emaki/*`) and a "Made with Emaki" credit. Other candidates were Lantern (too generic), Benshi, Kamishibai, Limn and Quire. We haven't done a formal trademark search yet.

## D-002: MIT license, no royalties

D-073 supersedes the license choice and retains royalty-free use.

The engine, the editor and the exporters are free, and games made with them owe nothing. Ren'Py is MIT and free; a fee on Emaki's core would be the first reason not to switch. (An OSI license can't carry a royalty anyway.) If paid things ever exist, they'll be optional services around the engine, such as console-port support or cloud builds, never a charge on the core or on games.

## D-003: TypeScript everywhere, for now

TypeScript has the biggest pool of contributors, the editor is a web UI problem anyway, and it makes web and phones real targets rather than ports, which is where Ren'Py is weakest. Consoles will need a native player that reads the compiled format (D-005).

## D-004: No build step

Node 22.18 and later run `.ts` files directly, and Vite and Vitest handle the same files, so packages export `src/index.ts` and nothing gets compiled. The catch is that only erasable TypeScript is allowed: no enums, parameter properties or namespaces. If we publish to npm we'll add a build that emits `.js` and `.d.ts`.

## D-005: Stories compile to a portable JSON instruction list

A `.vn` file is parsed to an AST and compiled to a flat array of instructions, with jump targets resolved and expressions stored as JSON trees. A runtime in any language (TypeScript today, maybe Rust or C++ for consoles) has to implement about 14 opcodes and a small expression evaluator. The spec is in docs/story-format.md, versioned by `FORMAT_VERSION`.

## D-006: Screenplay-style syntax, close to Ren'Py

Writers already know Ren'Py, and staying close to it made an importer realistic (it exists now, D-072). Where we differ, it's on purpose:

- Dialogue is unquoted, like a screenplay: `mira: Hello.` Quotes are allowed.
- `set x += 1` instead of `$ x += 1`. There's no embedded Python, just a small sandboxed expression language with `and`, `or` and `not`.
- Variables are declared (`var trust = 0`), so a typo fails at compile time.
- Reaching the end of a label returns, or ends the story. Ren'Py falls through into the next label, a classic source of bugs.

## D-007: Expressions are sandboxed, not JavaScript

Expressions have to run in native runtimes too, mustn't reach the host, and should be easy to analyse: knowing which variables an expression reads gives us typo detection and reachability. Power users who need real code get plugins (D-055), not inline JavaScript.

## D-008: Line ids are the label plus a hash of speaker and text

*Provisional.*

Ids key translations, let live reload resume at the right line, and later make saves sturdier. Editing a line changes its id, which is what translation wants ("this changed, translate it again"). Identical lines in one label get `.2`, `.3` and so on. Still open: optional explicit ids (`#id`) for lines a writer wants to pin.

## D-009: The runtime is a headless VM that produces steps

The runtime knows nothing about the DOM. Each step is a list of effects plus one blocking event, so it runs in Node for tests and any renderer can drive it. Rollback keeps a snapshot per blocking event, up to 500. A save is a full state snapshot plus the story's hash. After a live reload, `resume()` finds the same line by its id even if the story changed around it.

## D-010: DOM and CSS first, WebGL later

The first player is plain DOM. It's accessible, the text is sharp, and it's small (about 13 KB gzipped with the engine). The effect/block contract sits between VM and renderer, so a PixiJS or WebGL renderer could replace it later for shaders and particles without touching the VM.

## D-011: Sprite attributes replace, they don't merge

*Provisional.*

After `show mira smile`, the line `mira sad: ...` leaves her with `[sad]`, not `[smile, sad]`. That's simpler than Ren'Py's attribute merging. Revisit if layered characters (D-039) make merging worth having.

## D-012: Comments are whole lines starting with `#`

*Superseded by D-057.*

Inline comments would clash with dialogue that contains `#` ("mira: Room #4"), so a comment had to be a whole line. The formatter keeps them (D-015).

## D-013: The story map is a dev-only tool

The flowchart of scenes, play-from-here and live variable editing are there to help writers test routes. They load lazily, on the dev server only: the Vite plugin emits the story graph only when serving, and the map module sits behind `import.meta.env.DEV`. A published game never ships a spoiler map of its own routes, or the code to draw one.

A route chart for players, like the ones some VNs unlock after you finish, would be a separate opt-in feature.

## D-014: The flowchart layout is our own code

It's a small Sugiyama-style layout (back-edge detection, longest-path layering, barycenter ordering) in `player-web/src/map/layout.ts`. Story graphs have tens to a few hundred labels, so a 200-line pure function beats pulling in dagre or elkjs. It's DOM-free and tested, and the editor reuses it. Revisit if large stories need better edge routing.

## D-015: Comments and blank lines live in the AST as leading trivia

Every node (declaration, label, statement, menu choice, `elif`/`else` branch) can carry `leading: string[]`, the comments and blank lines written directly above it. Comments after the last line go in `Program.trailing`. The printer writes them back, so neither the formatter nor the visual editor loses a writer's notes.

The AST is canonical: `parse(print(ast))` equals `ast`. Runs of blank lines collapse to one, and a blank line is dropped where the printer would put one anyway (start of a block, before each label, before the first item of a declaration group). A canonical file round-trips byte for byte, and CI runs `emaki fmt --check` on the demo.

A comment attaches to the next line whatever its indentation, so a note at the end of a block moves below the block when formatted. It's simple and predictable. We'll change it if writers find it surprising.

## D-016: Text styling is Markdown-like and compiled into spans

`*italic*`, `**bold**` and `[color=...]...[/color]`. Writers know Markdown already, and square-bracket tags can't clash with `{variable}` interpolation.

Markup is parsed at compile time. Instructions keep plain `text` and gain optional `spans`, so the format change is additive (`FORMAT_VERSION` stays 1) and a variable's value can never be read as markup. Unbalanced markers are errors; we don't guess what was meant. Quoted strings keep unknown backslash escapes such as `\*`, so escaping works the same whether a line is quoted or not.

## D-017: Player settings are per game, validated, and applied through CSS variables

Text speed, auto-advance wait, volumes, text size, text box opacity, font and animations are stored in localStorage per game title. Each value is clamped or defaulted when loaded, so a bad stored value can't break the player. Everything visual goes through CSS variables and classes on the stage, so a theme can restyle it without code. Animations default to following the device (`prefers-reduced-motion`); D-024 changed what that affects.

## D-018: The stage adapts to its host

The player makes the element it mounts into a CSS size container and lays out from the host's shape, not the window's. The dev story map, an embed and a phone all behave the same way.

Wide hosts get a 16:9 letterbox. Hosts taller than 4:5 get the portrait layout: the stage fills the host, backgrounds crop to the centre, characters stand above a full-width text box, and the quick menu sits below it in one row. Everything inside sizes off one unit, `--u` (1% of stage height in landscape, tied to width in portrait), and sprite positions are CSS variables (`--pos-left`, `--pos-center`, `--pos-right`), so a theme can retune either layout. Games are still authored for 16:9. Per-image focal points for portrait cropping can come later.

*Amended 2026-11-20.* Games with a `canvas:` header place pictures and screens in pixels on that canvas, and the portrait layout stretched them (a narrow editor pane showed a title screen squashed). Those games are now always letterboxed at their own aspect, phones included; the host's container gets a different name so the portrait rules don't match. Later the same day this became the `orientation:` header (D-069).

## D-019: Preloading looks ahead without running; the player waits briefly, never forever

`Runner.upcomingImages()` walks the compiled code from the current position without executing it: every branch of conditions and menus, into calls and back out, a few lines or menus ahead, with a hard cap on instructions visited. It's deterministic, testable without a browser, and any future runtime gets the same behaviour.

The web player keeps those images loaded and decoded in a small most-recently-used cache. When a step changes the picture, the player holds it for up to 1.5 s until its images are ready, so nothing fades in half-loaded. A slow or missing file never blocks the story, and skip mode doesn't wait at all.

## D-020: Language support is editor-agnostic, and the VS Code extension is a thin adapter

`packages/language` (first written as `packages/vscode/src/language.ts`) provides problems, symbols, definition, references, hover, completion and formatting as plain functions over text and 0-based positions. It's built on the real compiler, so editors always agree with `emaki check`. It has no VS Code imports and has its own unit tests. The web editor uses it too, and a language server could later. `extension.ts` only translates to the VS Code API.

This is the one package with a build step. VS Code can't run TypeScript, so esbuild bundles the extension and the compiler into a single file with no dependencies. The TextMate grammar is tested with `vscode-textmate`, the engine VS Code itself uses. The extension isn't on the Marketplace yet.

## D-021: Line previews rebuild the scene by replaying the label

`Runner.startAtLine(n)` starts at the first instruction on or after line `n`. So that it doesn't open on a black screen, it first replays the `scene`, `show`, `hide` and music statements from the top of that label down to the line, ignoring conditions and menus. If two branches both change the picture, the later one wins.

Running the whole story up to the line would need a path of choices that reaches it, and with the variables being tested there may not be one. Replaying the label is an approximation, but a predictable one, and it covers the usual case where a label sets its scene near the top. Writers can set variables in the link (`?line=52&trust=2`).

Previews only exist in dev; a published build ignores `?line=`. After a live reload the player resumes where it was unless the address changed, so following a new preview link always wins.

## D-022: Accessibility fonts ship with every game and load on demand

Players can switch story text to Atkinson Hyperlegible (designed for low-vision readers) or OpenDyslexic. Both are under the SIL Open Font License, so any game, commercial or not, can ship them. They come from `@fontsource` packages and are bundled into the build instead of loaded from a font CDN, so games work offline and don't contact anyone.

Only the `@font-face` rules load up front. A font's files download the first time a player picks it, so a game where nobody switches pays nothing. OpenDyslexic's large letters are evened out with `font-size-adjust`.

## D-023: The demo uses CC0 recordings, and the player uses plain HTML audio for now

Games bring their own audio. The demo only needs enough to exercise the audio path and sound decent, so it uses CC0 recordings from OpenGameArt, credited anyway in `CREDITS.md`, which ships with the build. Synthesising placeholder tracks would have been code nobody needs. We passed on CC-BY tracks so the demo carries no attribution obligations. Files are MP3 because every browser plays it.

Playback stayed on `HTMLAudioElement`. `fade` works on `play` and `stop`, a new track crossfades over the old one, and sound effects aren't played while skipping, rolling back or loading, so they can't fire in bursts. The small gap at MP3 loop points was fixed later with Web Audio (D-041).

## D-024: Reduced motion doesn't change text speed

*Amends D-017.*

Reduced motion used to make text appear instantly too, and that surprised people. Windows reports reduced motion whenever "Animation effects" is off, a common setting, so for those players text never typed out, even with Text speed set.

Reduced motion is about movement: fades, slides, a bouncing indicator. Letters appearing in place aren't movement. Text speed alone now controls typing, and it has its own Instant option. Reduced motion still makes transitions instant and stops the next-line indicator from bouncing.

## D-025: The editor is a local web app over the game folder

`npm run edit` serves the editor with Vite, just as `npm run dev` serves the game. A small plugin gives the page one API: read and save `story.vn`. The file on disk stays the source of truth, so a writer can have the editor, VS Code and git open on the same file at once.

The editor is built from parts we already had. The script pane is CodeMirror 6 driven by `@emaki/language` (moved out of the VS Code extension for this), so both editors report the same problems. The game pane is the real web player, and the flowchart uses the story map's layout. As you type, the script recompiles and `Player.reload()` swaps the new story in at the same line through `Runner.resume()`, the path live reload already uses, so the music and the scene carry on.

Saving happens a moment after typing stops. Each save names the version of the file it was based on (a hash). If the file changed on disk in the meantime, the save is refused and the writer picks which version to keep. A change on disk is only loaded silently when there are no unsaved edits. Writes go to a temporary file that's then renamed, and keep the file's line endings. The API only answers the editor's own page, so another site open in the browser can't rewrite the script.

## D-026: Visual edits are tree edits printed back to text

The flowchart and the asset browser never keep their own copy of the story. Each action (add, rename, delete or connect a scene; declare or drop an asset) is a pure function in `@emaki/language/edits`: parse the script, change the tree, print it. The printer keeps every comment (D-015). The editor applies the result as an ordinary edit, so it's saved, played and undone with Ctrl+Z like typing.

A script with syntax errors is never edited, because printing an incomplete tree could drop lines; the editor asks the writer to fix the error first. And since the printer is canonical, the first visual edit to an unformatted script also tidies its layout, as `emaki fmt` would.

The edits are cautious on purpose. Deleting a scene is refused while anything still leads to it, and the start scene can't be deleted. Connecting a scene adds a `jump` if the scene just ends. If it already jumps, the jump becomes a `menu` with a placeholder choice per destination ("(Choice) Kitchen talk"). A scene that ends in a menu gets one more choice, and a scene that `return`s is left alone. Anything subtler is better written as text, and the flowchart shows where: click an arrow to see its line.

## D-027: Dropped assets are copied in, never overwritten, and named from the file

Files dropped from the computer go to `assets/images/` or `assets/audio/` under a cleaned-up name. If the name is taken, identical bytes reuse the existing file and different bytes get a numbered copy. Nothing a writer made is ever replaced.

The declaration is named after the file: `Cliff Road (dusk).png` becomes `cliff_road_dusk`, a `bg_` prefix is dropped, and a file starting with a character's id (`mira_smile.png`) becomes that character's sprite, `mira smile`. Dropped inside a scene, the asset also gets a statement: `scene` for a single name, `show` for a sprite, `play music`, or `play sound` for files in an `sfx` or `sound` folder. Uploads are only accepted from the editor's own page, and only for image and audio types.

## D-028: Translations are catalogs keyed by line id

Each language is one file in the game's `lang/` folder: `fr.po` for translation tools (Poedit, Weblate and Crowdin all read gettext PO) or `fr.csv` for spreadsheets. Entries are keyed by the line's stable id (D-008), stored in `msgctxt`, so the same sentence in two scenes can be translated two ways.

The compiler lists every string a player reads (lines, choices, character names, the title, achievements) with its id and raw source, markup included, so the exporter and the runtime can't disagree about ids. The player's own buttons (`ui.*`) go in the same file, so a translated game is translated all the way through.

`emaki strings --lang fr` creates or updates a catalog and keeps existing translations. Editing a line changes its id, so the update offers the closest old translation from the same scene (word similarity of 0.5 or more) as a *review* entry, which is "fuzzy" in PO. Translations of deleted lines are kept as obsolete, so no translator's work disappears. The game only uses reviewed (`ok`) entries and shows the original otherwise. Compiling a translation checks its markup and refuses `{variables}` the original line doesn't use, because a typo there would show players "{nmae}".

At run time `Runner.setTranslation()` swaps text by id as blocks are built. Switching language mid-scene redraws the current line, and rollback, loading and the history log follow the new language. The language picker in Settings defaults to the device's languages (exact match first, then the base language, so `pt-BR` falls back to `pt`) and sets `lang` and `dir` on the stage for right-to-left scripts. Plural forms aren't supported yet; PO entries that use them are reported and ignored.

## D-029: Desktop export uses Electron, not Tauri

Tauri apps are far smaller, a few MB against roughly 300 MB unpacked. But Tauri renders with each system's own web view (WebView2 on Windows, WebKit on macOS, WebKitGTK on Linux), and those differ in audio, fonts and CSS container queries, which the player depends on (D-018). Tauri also needs a Rust toolchain on every developer's machine.

Electron ships one known Chromium everywhere, so a game looks and sounds the same as on the dev server, and exporting needs nothing but npm: `@electron/packager` downloads the right Electron per target, so one machine can build for Windows, macOS and Linux. The shell (`packages/desktop/app`) is a little plain JavaScript, shipped as is. It serves the game over a private `app://` scheme because `file://` can't load module scripts. Pages have no Node access (context isolation, sandbox), and the only bridge is the `EmakiHost` interface. Chromium's own UI translations, which a game never shows, are trimmed to English plus the game's languages, saving about 45 MB.

We'd look at Tauri again if download size became the main complaint and system web views had caught up. Windows exports now default to a WebView2 player anyway (D-067).

## D-030: Steam is optional, through steamworks.js, behind the host bridge

A game opts in by adding `steam_app_id` to its header. Only then does the desktop export include `steamworks.js` (MIT, prebuilt per platform, with Steam's own library), unpacked outside the asar archive so it can load. The shell starts Steam before opening the window, which the overlay needs, and maps `achieve <id>` to the Steam achievement with the same id. Without Steam, the game just runs.

Achievements are part of the language: `achievement id "Name"` declares one and `achieve id` awards it. So the compiler catches typos, the names get translated, and every platform does something sensible: Steam's popup on Steam, an in-game notice and a local record elsewhere. The player reaches platform features only through `window.emakiHost` (quit, full screen, achievements, back button), which each shell implements as far as it can, so one web build runs everywhere.

The compiled format gains an optional `achievements` table and an `achieve` op. Like styled spans (D-016), that's an addition, so `FORMAT_VERSION` stays 1 until the format is first published.

## D-031: Phone export generates a Capacitor project once, then syncs it

`emaki export android|ios` writes a Capacitor project to `<game>/export/mobile`. The first export runs `npm install` and `cap add`; later ones copy the new web build in with `cap sync`. Changes made in Android Studio or Xcode (signing, icons, store settings) survive re-exports, and the generated projects are ordinary ones that any Capacitor guide applies to.

The engine itself doesn't depend on any Capacitor package. The project pins compatible versions, and the player finds the App and StatusBar plugins on `window.Capacitor` at run time, for the back button, quitting on Android and hiding the status bar. An APK is only built when the Android SDK is found. Otherwise, and always for iOS off a Mac, the export prepares the project and says exactly what to do next. Store signing stays in the native tools, where the requirements keep changing.

## D-032: Skip stops at unread text by default

The player records which lines have been read, by id (D-008), across every playthrough on the device, and skip stops at the first unread one. That's what makes replaying a branching story for its other routes bearable, and it's what players of the genre expect. Since an id hashes the text, a line the writer changes counts as unread again, which is right: it's new text.

Settings has "Skip: Text you have read / All text" for players, and writers testing, who want to skip everything. The record is one JSON list per game, written in batches so skipping thousands of lines doesn't hit storage on every line.

## D-033: The title screen can be customised three ways

Header keys cover most games: `title_image`, `title_music`, `title_logo`, `title_layout`, `title_buttons`. A `theme.css` in the game folder can restyle anything, against a documented and stable set of class names (docs/theming.md). For full control, a label named `title` *is* the title screen. It plays like any scene, and its `menu:` becomes the title menu, followed by the built-in Load, Settings and Quit.

That keeps the title screen in the story language, so conditions, `global var` unlocks, translations and the editor all work on it unchanged. A choice on the title starts a new game from that choice, with rollback cleared so going back can't land in the title. `title` is never picked as the default start label and always counts as reachable.

Screens (D-049) later added a fourth way, `screen title`.

## D-034: A story can span many files, with story.vn as the main one

Every `.vn` file in the game folder, except under assets, lang, dist, export and tools, is part of the story, in one shared namespace. There are no `include` lines to keep in order, and scenes can move between files freely because line ids depend on the label and text, not the file. Only story.vn has a header.

The compiler parses each file, tags every location with its file, and compiles the merged program. Diagnostics, source references in the compiled story, the story map, preview links (`&file=`) and translation references all name the file. Locations in story.vn carry no file, so single-file stories compile exactly as before. The editor and VS Code analyse each file against the others' current unsaved text, and flowchart edits work across files: renaming a scene updates jumps everywhere.

## D-035: Features come from real games

*Process.*

To find out what Emaki couldn't express yet, we ported a complete existing visual novel: 34 scripts, about 4,600 lines, 1,700 voice files, three endings. The conversion script was kept out of this repository. Only general features the port showed we needed went into the engine: `aspect`, real sound and voice channels, percentage positions, `global var`, `narration: plain`, read-text skip, the scripted title screen and multi-file stories.

That's how new features should keep arriving: because a game needs them, not because they're on a list.

## D-036: NVL mode is story state, and pages turn by themselves

`nvl on` switches to full-screen pages of text, `nvl off` goes back to the text box, and `nvl clear` starts a new page. `nvl: on` in the header starts the whole story that way.

The lines on the current page are kept in the runner's state (at most 40; a page usually shows fewer), so rollback, loading and switching language redraw exactly what was on screen. The player lays out a page from its first line and starts a fresh one when the next line won't fit, like a printed novel or a DS visual novel, so writers rarely need `nvl clear`. A new `scene` also starts a new page. The typewriter writes into whichever element shows the current line, so typing, auto, skip and voices behave the same in both modes.

## D-037: Extras come from declarations, and progress is per device

A gallery image is an ordinary image declared with `gallery`. An ending is declared with `ending id "Name"` and reached with `end id`. Keeping both in the script means the compiler checks them (an `end` with a misspelled ending is an error), the names get translated, and the Extras screen needs no separate configuration.

The player records gallery images the first time they're shown, even while skipping, and endings when they're reached, across every playthrough on the device, next to achievements. The Extras screen (from the title) shows locked entries as ???. A script that needs to react to progress, say an epilogue that unlocks after every ending, uses `global var`.

## D-038: The camera is scene state; shakes and flashes aren't

`camera zoom 1.5 at 70% 30% over 3` zooms the picture (backgrounds and characters, never the text) toward a point. The camera belongs to the scene, so saves, going back and starting from a line all show it where the script left it, and a new `scene` resets it. The zoom keeps the chosen point fixed on screen, so at zoom 1 or more you never see past the picture's edges. Panning is just zooming toward a different point. Camera moves don't block, so a slow pan plays under the next lines; add `wait` to watch it.

`shake` and `flash` are moments, not state, and are dropped when skipping, going back or with reduced motion. A flash only waits until the screen is covered, so a `scene` right after it changes unseen. None of `shake`, `flash` or `camera` are reserved words, so existing characters with those ids still work.

## D-039: Layered characters are declared in the script, one option per group

`layered mira:` lists `always` layers and `group`s of options, bottom first. Showing an option replaces only its own group's layer, and `-option` removes an optional group's layer. Writers know this model from Ren'Py's layered images. We kept to what covers most games and left out conditions and auto-picked layers.

Options use the same attribute syntax as plain images, so `mira smile: Hi` works whether Mira is one image or layers, and a game can switch to layers without touching its script. The player stacks one `img` per layer in the sprite box instead of compositing them into a single picture, so each layer loads and caches separately and changing a face reloads only the face.

## D-040: Voices are found by line id, from files that exist

The header `voice: voice/{speaker}/{id}.ogg` says where every line's voice would be. When the whole game compiles (CLI, dev server, export), Emaki checks for each line's file and stores the ones that exist in the compiled story, outside the story's hash. Recordings can arrive one session at a time without requests for missing files and without invalidating saves.

The ids are the ones translations use, which is also how Ren'Py's auto-voice works. The downside is that editing a line orphans its recording, so `emaki voices` writes the recording script and lists files that no line uses. An explicit `play voice` before a line still wins. The voice a line played is kept with the line, so the history log can replay it.

## D-041: Loops play through Web Audio, and ambience has its own channel

An `<audio loop>` element pauses briefly every time it wraps. That ruins music written to loop and makes rain stutter. Looping tracks (music, ambience, looping sounds) are now decoded and looped by Web Audio, which is sample-exact. One-shot tracks, and files Web Audio can't decode, still use `<audio>`. Decoded audio is big, about 10 MB a minute, so only the last four loops stay decoded.

`ambience` is a fourth channel because a scene's background sound (rain, wind, a crowd) outlives its sound effects. `stop sound` cuts the effects without silencing the weather. Like music, ambience is story state, so loading and going back restore it.

## D-042: Side images by naming convention, per-character text boxes through CSS

A side image is an ordinary image tagged `side`: `image side mira smile`. The runner remembers each character's latest attributes (from dialogue and `show`, and only in stories that have side images) and picks the most specific `side` image that matches all of them. So `mira smile:` followed by `mira:` keeps the smile even with no Mira sprite on screen. Attributes that only a side image uses don't affect the sprite. It's Ren'Py's convention, which people moving over already know.

Per-character text boxes need no new syntax. The box carries `data-speaker`, so one rule in `theme.css` can give a radio voice a monospace font or the narrator a different background.

## D-043: Pictures with text in them are translated by file name

A CG with a sign, a letter or sound-effect lettering needs one version per language. The translation sits next to the original with the language code before the extension (`cg/sign.png` → `cg/sign.fr.png`, `cg/sign.zh-Hant.png`), and the game uses it whenever that language is chosen. Pictures without a version stay as they are. There's no new syntax and no catalog entry: a translator who can draw just adds files. It works the same for backgrounds, sprites and their layers, side images and the gallery.

As with voices (D-040), the compiler looks for the files when the whole game builds and stores the ones that exist in the compiled translation, so the player never requests pictures that aren't there. Switching language redraws the scene.

Device languages are matched by script as well as base language: `zh-TW` and `zh-HK` get `zh-Hant`, `zh-CN` gets `zh-Hans`. We ran into that while porting a VN released in Japanese, English and both Chinese scripts.

## D-044: Character moves are named, not keyframed

`hop mira`, `nod mira 2`, `bow mira` and `shake mira` (and the same on `textbox`) cover what VNs use small sprite moves for: surprise, agreement, greeting, refusal. In one commercial VN we counted, these four made up nearly all of its 1,800 character and text box moves. Named moves read like stage directions, need no animation vocabulary, and keep the format portable, since a runtime only has to know four of them.

Distances are fractions of the screen's height, so they look the same at any size. Like `shake` and `flash`, moves are moments: they don't block, and skipping, rollback and reduced motion leave them out. A general transform language like Ren'Py's ATL stays out of the core. Endless loops such as a floating icon were left for later because they'd have to be scene state (they arrived in D-046), and keyframed animation came later still, with free layers (D-062).

## D-045: Movies block the story and can be skipped

`movie "path"` plays a video over the stage and the story waits, the way openings and endings usually work in VNs. A click, Enter, Space or Escape skips it without also advancing the line underneath, and skip mode and rollback never play it. It plays at the music volume and falls back to muted if the browser blocks sound. A movie is an effect, not state, so loading a save never restarts one.

Per-language versions use the same file naming as pictures (D-043). To allow that, the compiled translation's `images` map was renamed `assets` and covers movies too. We made the change before any game depended on the old name.

## D-046: Endless moves are sprite state

`float mira` and `shake mira forever` repeat until `still mira`. Unlike one-off moves (D-044), you'd expect to still see an endless move after loading a save or going back, so it's stored on the sprite (`loop`) and restarted whenever the player redraws the scene. Because it lives on the sprite, `hide` and a new `scene` end it with no extra bookkeeping. The text box can't loop, since a box that never stops shaking is hard to read. Reduced motion leaves loops out.

## D-047: Colour tones are scene state that outlives the scene

`tone sepia`, `tone mono` and `tone none` tint backgrounds and characters but not the text, which stays readable. A flashback usually spans several backgrounds, so unlike the camera, a tone survives `scene` and lasts until it's changed. Two named tones cover what VNs mostly use this for (the past, memories). Arbitrary colour adjustments stayed out until a game needed them, which happened with grades in D-062. The player animates the tone with Web Animations, separately from the camera's transform transition on the same layers.

## D-048: Furigana is markup: `[ruby=reading]text[/ruby]`

Japanese VNs annotate unusual readings, and Chinese translations sometimes keep them. Ruby follows the colour tag's form, so there's one bracket syntax to learn. It compiles to a `ruby` field on a span, and such spans never merge with their neighbours. Plain `text`, the history log and screen readers get only the base text. The player renders a real `<ruby>` element and centres the base under a longer reading instead of spreading its characters out.

## D-049: Screens are a small declarative language in the script

A game's own title screen and menus are `screen name:` blocks in the script, not HTML or a general-purpose language. Each element is one line (`button "New Game" image "ui/new.png" -> start if visits > 0`) and compiles to a JSON tree. That way the compiler can check labels, variables, images and screen names, translators get the text through the usual catalogs, and any future runtime can draw it.

Screens can't run code. They have a fixed set of actions (start, continue, open, close, title, quit, jump, set) plus conditions. That's enough for unlockable extras and route menus, and it keeps saves and the sandbox safe. Layout is placement plus rows, columns and boxes; appearance belongs in `theme.css`. Positions are percentages, or pixels on a declared `canvas` that get converted to percentages at compile time, so UI art drawn at a fixed size lines up exactly and still scales. Every button needs a text label even when it's a picture, because that's its accessible name and what gets translated.

`screen title` and `screen menu` replace the built-in screens; save, load and settings followed in D-050. We tested it by rebuilding the title screen of a commercial VN demo, and it now matches the original.

## D-050: Data screens bind to the player, not to code

Save, load, settings and extras need data a script can't compute: what's in each slot, the player's settings, what's unlocked. Rather than open the screen language up to code, we gave it elements bound to that data: `slots N -> load|save` (cells laid out by the writer, with `{slot_date}` and friends, and paging), `thumbnail`, `gallery`, `endings`, `achievements`, and `slider`, `toggle` and `choice` bound to named settings.

Thumbnails are the saved scene redrawn from the save itself (background, characters, tone, the game's theme), not screenshots. Saves stay small, old saves get pictures too, and nothing depends on a browser capturing its own page. `save_slots` in the header sets how many slots there are (3 by default, for games that keep the built-in screen). A game's `screen save|load|settings|extras` replaces the built-in one wherever it opens, and every control keeps a text label for screen readers and translators.

## D-051: Screens during the story are state, and a called screen blocks

`show screen hud` and `hide screen hud` change a list of shown screens that's part of the story's state, like the scene. Saving, loading, going back and line previews bring the right screens back without the player doing anything special.

`call screen map -> place` blocks like a menu. The runner waits on it and continues only through `returnFromScreen(value)`, which a button's `-> return value` action calls; going back returns to the waiting screen with the variable as it was. It's the open-ended version of `menu`, where the writer lays out the choices (pins on a map, apps on a phone) and decides what each one returns.

Story screens are drawn in their own layer between the text box and the quick menu, so even a full-screen one leaves save, load and settings in reach. The player's own screens (title, menu, save, load, settings, extras) can't be shown this way, because they belong to the player, not the story.

## D-052: The text box is a screen that places the player's own parts

`screen textbox` doesn't rebuild the text box. It places the player's existing line, name and side image elements (`dialogue`, `speaker`, `side`) among the game's own art and buttons. Typing, pauses, styled text, voices, read-text skip and the screen-reader live region keep working, because they're the same elements.

The screen sees a `speaker` variable, so name plates can depend on who's talking. Buttons on it replace the quick menu, and new actions (`back`, `auto`, `skip`, `hide`, `quicksave`, `quickload`, `voice`) give a custom text box every control the built-in quick menu has. It's redrawn every line, so its buttons always reflect what's possible right now.

## D-053: Picture states, settings as buttons, and input with no setup

Commercial UI art usually comes as sprite sheets of states, so buttons and slots take a picture per state: idle, `hover`, `pressed`, `selected` and `disabled`. "Selected" is computed, not declared. A button is selected while its action is in effect (auto is on, its page or tab is showing, `setting name value` holds), which covers radio-style option pictures, tabs and page numbers without any variables.

Picture sliders are a gauge revealed up to the value plus an optional knob, the usual VN shape. Gamepads work on every screen without a declared focus order: the d-pad picks the nearest control in that direction. Fades (`screen x with fade`), click and hover sounds (header keys) and a live screen preview in the editor came along with it.

Tested on the same demo: its title, text box, save, load and four settings pages look like the original, with settings Emaki doesn't have drawn at their defaults.

## D-054: History, confirmations and the audio mix are the game's to draw

These were the last built-in pieces a custom UI couldn't replace. `screen history` gets a `log` element: the writer lays out the entries, each with `voice` and `rewind`, and it scrolls by line or by window. `screen confirm` draws every question the player is asked before something that can't be undone. Questions go through one generic flow (`ask(kind)`), so each can be turned off with a `confirm_<kind>` setting and drawn per kind (`{confirm}` picks the picture with the question drawn in).

The audio mix gained a master volume, mutes that remember their level, and per-character voice volume and mute keyed by `define` id, since the voice that plays always knows whose line it is. Skip to the next choice (through unread text) and back to the previous one, `reset`, and voice `sample` buttons fill out what a VN settings screen usually has. On the same demo, the backlog, the yes/no dialog, the sound page (master, channels, ten characters, test buttons) and the dialogs page all work like the original.

## D-055: Plugins are code next to the story, described to the compiler

This is the escape hatch D-007 promised. A plugin is a folder in the game (`plugins/<name>/`) with a `plugin.json` manifest and an `index.js`. Scripts call it with `@name command key=value` lines, and screens with `@name element`. The `@` means plugin names can never clash with characters or future statements, and named arguments keep calls readable and checkable.

The manifest declares every command, element and argument type, so the compiler, CLI, editor and exports check plugin use without running plugin code, the same way they check labels and variables. VS Code skipped these checks at first because it didn't know a game's plugins; D-058 fixed that.

A command is an effect, or it blocks the story (`waits`) and returns a result into a variable, like `call screen`. Lasting effects are saved as the command and its arguments, and come back by being run again after the plugin's `reset()`, so plugins never deal with saves, rollback or line previews themselves. Plugins could only read variables at first, and the story changed only through results; D-066 relaxed that. Events (line, choice, ending, achievement, save, load) cover analytics and integrations.

A plugin is trusted like the rest of the game. There's no sandbox. A plugin that fails is logged and never stops the story. Functions in expressions waited until we'd worked out how they interact with rollback (D-058).

## D-056: Scene replay and the music room unlock like the gallery

Both are declared in the script and unlocked by playing, like `image ... gallery`. `audio ... music "Title"` marks a track for the music room, unlocked once it plays as music. `replay label "Name"` marks a scene, unlocked once one of its lines is shown. Both are remembered across playthroughs on the device.

A replay is a mode of the runner, not a copy of the scene. It starts at the label with fresh variables (globals kept) and ends where the story leaves that label at the top of the call stack, so calls are still part of the scene. `until label` covers scenes spread over several labels. Replays can't be saved, and they end back on the Extras screen they started from.

The music room swaps the music for its track and puts back whatever was playing when the player leaves. The built-in Extras screen gets Scenes and Music tabs; a game's own screen uses the `scenes` and `music` elements. On the demo we tested, the music room lists all 37 of its tracks in the original's order.

## D-057: End-of-line comments need a space on both sides of the `#`

Writers wanted notes beside a line (`scene kitchen  # morning light`), which D-012 ruled out because dialogue can contain `#`. The rule that allows both: `#` starts a comment only with a space before it and a space (or the end of the line) after it, outside double quotes. Hashtags, room numbers and colours (`#4`, `#e8b04b`) stay text. The rare line of dialogue with a free-standing ` # ` is quoted or written `\#`, and the formatter quotes such lines itself so its output always reads back the same. No existing script in our test games changed meaning.

Comments live in the AST as `comment` next to `leading` (D-015), header entries included, so the formatter and the visual editor keep them, two spaces after the line.

## D-058: Plugin functions in expressions: `@plugin.function(args)`

Plugins can answer questions as well as run commands: `if @dice.roll(6) > 4:`. The `@` separates them from variables (and any future built-in functions), and the `.` from commands. Arguments are positional, with optional ones last, like functions everywhere. The manifest's `functions` table lets the compiler check the plugin, the function, the number of arguments and literal values.

Calls are part of the expression tree, so anything that evaluates expressions can make them: the runner through `Runner.callPlugin`, screens through their host. Functions are synchronous and return a number, text or boolean. Anything else, or an exception, stops the story with a message naming the function, because a condition can't continue without its value.

The story doesn't record answers for rollback. Going back restores the variables, and playing on evaluates the expression again, so a random function may answer differently. That keeps plugins free of save and rollback concerns, the same trade D-055 made for lasting commands. Starting values can't call plugins, since they're computed at compile time. Editors read the manifests too (VS Code reads `plugins/*/plugin.json` next to the story and watches it), so `@` lines are checked and completed everywhere.

## D-059: Story files are packed, and runtimes expand them on load

A full-length game (80,000 lines, three routes) compiled to 31 MB, and 44% of that was each instruction's `src`, repeating the same file and label on every line of a scene. Story files are now packed (version 2): `src.file` and `src.label` appear only where they change, and `say` drops `who: null` and empty `attrs`. Loading expands them again, so the runtime, saves, translations and every tool still see the version 1 shape. A runtime in another language has to implement one small loop.

Packing is a file format, not compression. The result is still plain JSON that gzips well (3.6 MB for that game), and hosts compress it in transit. Loading the story in parts, the bigger change for very long games, is a separate question (D-061).

## D-060: Game data is fetched as JSON, and the dev server reads assets on demand

The story used to be compiled into the player's JavaScript as a module. For a full-length game that meant tens of megabytes that Vite transformed and the browser parsed as code on every reload. Builds also carried every script's source lines, for an error screen only the dev server shows.

Now a build writes `game.json` next to `index.html` (the packed story from D-059, plus translations), and the player fetches it on startup. The dev server answers the same request from a compile it keeps until a file changes. JSON parses faster than code, the module shrinks to a few lines, and the story becomes something the player loads rather than part of its code, which loading in parts would need. Every way a game runs already serves files over a URL (web hosts, the desktop `app://` scheme, Capacitor's local server), so the fetch works everywhere.

The dev server also stopped using Vite's public folder for `assets/`. Vite lists and watches every file there at startup, which took most of a minute for 31,000 pictures and voices. Now each asset is read from disk when it's asked for, with byte ranges for audio and video. Recompiles reuse unchanged files and labels (`CompileCache`), so an edit in one scene of an 80,000-line game recompiles in about a tenth of a second.

## D-061: Loading the story in parts

*Proposed, not built.*

After D-059 and D-060, a full-length game (80,000 lines, 187,000 instructions) is a 19 MB `game.json`, 3.6 MB gzipped. It parses in about half a second and takes about 50 MB of memory. That's fine on desktops and current phones, so this is written down for when a game or a device needs it, not scheduled. Roughly:

- Chunks by file. `emaki build` writes the shared part (header, declarations, label table) plus one chunk per script file. Jump targets and the label table become (chunk, index) pairs, so a chunk can be relocated and loaded on its own.
- The runner asks for code. `Runner` gets instructions from a loader instead of an array. Running into a chunk that isn't loaded is a pause the host resolves (fetch, then continue), like a waiting plugin command. Preloading follows `call` and `jump` targets and the choices on screen, so in practice the pause shouldn't show.
- Other things change with it. Saves store positions as (chunk, index). Skip to next choice, rewinding through the history and line previews have to cross chunk boundaries. Translations and voices split the same way. The story hash becomes a hash of chunk hashes, as it already is of label hashes (D-060).
- It isn't free. Every runtime has to implement the loader, which grows the format contract (D-059), and everything that scans the whole story (reachability, skip to next choice, the story map) has to work with parts. It's worth doing when a real game needs it, such as a long game on low-memory phones, and it should be measured on that device first.

## D-062: Free layers: the picture as stacked, transformed images

Characters on a line plus one background covers most visual novels, but not games where every shot is composed: a background built from several pieces, a close-up made by zooming a picture, a face crossfading on a copy of its layer, light layers in `add` or `multiply`, manga-style panels with soft edges, slow pans that keep going under the text. One full-length commercial VN we tested against does this on nearly every page, with about 55,000 picture placements, 24,000 keyframed moves, 25 blend modes and 80 colour grades. Emaki now draws all of that itself, in the same player, instead of approximating it.

Everything on the picture is a *layer*: a declared image with a name, position, anchor, zoom (one or two axes), rotation, opacity, depth, blend mode, colour grade and blur. Backgrounds and characters stay as they were (`scene`, `show mira smile at left`). They're layers with default values, so old scripts draw exactly as before.

```
show street as far at 50% 50% zoom 0.65 rotate -17.3 opacity 0.87 depth 26
show glow as light at 960 540 blend add opacity 0.5
animate far zoom 0.7 over 3 ease in-out-sine
animate light with flicker
with dissolve 0.4
```

- `at x y` puts the image's anchor at that point, in percentages of the screen, or in pixels when the game declares `canvas: 1920x1080` (screens use it already). The anchor is the centre unless the image declares one (`image aki pose = "..." anchor 56% 47%`). At zoom 1 an image's pixels are canvas pixels; without a canvas, 1920x1080 is assumed.
- `as far` names the layer, so one image can be on screen twice, and a layer can change its picture and keep its place (`show street_night as far`). Without `as`, the name is the image's tag, as it is for characters.
- `animate <layer> <properties> over <s> [ease <name>]` moves toward new values without holding up the story. The eases are linear plus Penner's set (`in-`, `out-`, `in-out-` and `out-in-` of quad, cubic, quart, quint, sine, circ, expo, elastic, back and bounce). The state stores the target, so a save, a load or a rollback shows the layer where it was heading, as skipping does.
- `animation flicker loop:` declares keyframes (`0.4 opacity 0.6 ease out-sine`). Each key sets only what it names and the rest hold. Curves the eases can't express are written as closer keys. `animate light with flicker` starts an animation and `animate light stop` ends it. Shakes, quakes and sways are just animations, so they need nothing of their own.
- A `with` on its own line shows every picture change since the last line through one transition: `with dissolve 0.5`, or a wipe through a greyscale rule picture, `with wipe "rules/diagonal.png" 0.8`. `scene` and `show ... with` work as before.
- `grade dusk: gamma 0.94 0.78 0.57 levels #000010 #546b90 tint #ff6500 14% overlay` declares a colour grade, and `grade dusk` on a layer applies it. `silhouette #ffffe5`, `bright 1.2`, `contrast 0.8` and `blur 6` are layer properties too. Everything after the greyscale step is a curve on each channel separately, so one `feComponentTransfer` table per channel draws it exactly. The curve is `gradeChannel()` in the format package, shared by every runtime. `tone` (D-047) stays, as a grade on the whole picture.
- `clip 0 135 1920 810 feather 32` shows only that rectangle of the screen, with edges fading over 32 pixels, for letterboxes and manga panels. Layers in the same panel each carry the clip.
- `textbox hide [over s]` takes the text off the picture until the next line, for shots meant to be seen whole.
- `play ambience "wind.ogg" as wind` allows several loops at once, and `stop ambience wind` stops one.

The DOM player draws it with one stacking order for all layers (absolutely placed elements with CSS transforms), CSS blend modes, SVG filters for grades (`feComponentTransfer` for gamma and levels, `feFlood` plus `feBlend` for tints) and masks for panels. A `with` lays a frozen copy of the old picture over the new one and fades or wipes it away; a wipe steps through threshold masks made once from the rule picture. Subtractive blending has no CSS equivalent, so the layer is added (`plus-lighter`) between two inversions of what's behind it (`backdrop-filter: invert(1)`): 1 − ((1 − b) + s) = b − s, which is exact.

We considered WebGL. It would be exact everywhere, but it means a second renderer for pictures the DOM already draws, and giving up CSS for theming. It stays the fallback if the DOM ever can't keep up.

In the format, there are new instructions `animate`, `with` and `textbox`. `show` gains a `layer` name and optional `props` (panels are the `clip` and `feather` props, not a table of their own), and the story carries `animations` and `grades`. `FORMAT_VERSION` goes to 3 (2 was the packed files of D-059), since a runtime that doesn't know these can't draw the story.

We checked the result by comparing screenshots of the same moments in the original game and in Emaki, scene by scene.

## D-063: What Esc and right-click do

Many commercial VNs have no quick menu. You right-click or press Esc to open the menu, or to hide the text and look at the picture. Emaki had no right-click at all, and Esc did nothing during the story.

Both now open the game's menu (`screen menu`, or the settings) by default, and right-clicking again closes whatever is open. Two header keys change that, `escape:` and `right_click:`, each taking `menu`, `save` (the first empty slot), `quicksave`, `hide`, `settings`, `history` or `none`. While the interface is hidden, any click, Esc or right-click brings it back first. An unknown action is a warning and falls back to `menu`.

One action per key covers what players expect without inventing a key-binding language. Full rebinding can come later as a player setting.

## D-064: A local launcher reuses the editor, player and exporters

`emaki launch` (or `npm run launch`) opens a local project manager in the browser. You can create or open a game, reopen recent ones, open a game's editor or player, and export for web or desktop. `emaki edit <game>` and `emaki play <game>` work directly too, and the older commands and environment variables still work.

The launcher lives in the CLI (`src/launcher.ts`, with the browser UI in `launcher/`) and adds no UI dependencies. It runs the real editor and player as Vite servers, reuses one session per game and mode, and closes them on shutdown. The editor's configuration is shared with its existing Vite entry point. Exports run the CLI in a child Node process, so their build environment can't affect the running editor or launcher, and their output and errors show in the launcher.

Game folders stay independent of the engine. Only recent paths and timestamps are stored, in `~/.emaki/launcher.json` (override with `EMAKI_LAUNCHER_STATE`). Removing a recent project never deletes its files, and moved projects show as missing. The folder browser comes from the local backend, because a browser can't hand over arbitrary local paths from its native picker. Every launcher API binds to 127.0.0.1 and rejects cross-origin requests, file-system reads included. A packaged app with native dialogs could reuse all of this; at this point it still needed the repository and Node installed, which D-068 dealt with.

## D-065: One editor, three workspaces

The editor showed the script, the game and a flowchart side by side. Writers wanted what game engine editors have: somewhere to stage a scene and somewhere to plan routes, without leaving the script behind.

The editor now has three workspaces over the same panes: Write (script and game), Stage (game, inspector, and the scene's lines as a timeline) and Story (flowchart). Switching only changes the layout, so the game keeps running and nothing reloads. Every panel follows one position, the file, scene and line under the cursor, and shows what it knows about it.

The inspector and the stage edit one line at a time. The statement on the cursor's line is parsed alone, changed, printed with the printer's statement printer, and put back in place of that line. The rest of the file is never reprinted, so the writer's own layout survives, and the change is a normal undoable edit. Structural edits that move scenes around (the flowchart, asset drops) still print the whole file (D-026).

Speed is part of the design. Long games (D-059 to D-061) mustn't get slower, so nothing new runs on each keystroke. The inspector parses one line when the cursor moves. The timeline is rebuilt from the analysis the script pane already does when typing pauses, and only draws the columns in view. Route search runs the real runner in a worker with a time budget, so the page never waits on it.

*Amended 2026-11-18 (second pass).* The workspaces now share one layout: scenes and routes on the left, the inspector on the right, the scene's lines along the bottom, and only the middle changes (script and game, the stage, or the flowchart). A route to an ending is chosen once for the whole editor. Every "play from here" starts with that route's variables at the line, found by playing the scene from the route's values with the route's choices (the real runner, one scene at a time, cached per scene, route and compile). The route search records each variable's value as every scene begins, which the flowchart colours by and the scene card shows. It runs when the editor opens and while Story is showing, not after every edit, so writing doesn't compete with it for the CPU.

## D-066: Plugins can change listed variables, keep their own data, and have types

Plugins (D-055) could only change the story through a waiting command's result, had nowhere to keep their own data, and came with no types. A studio writing a battle system, a shop or a minigame with high scores would run into all three.

plugin.json now lists the variables a plugin may change (`"sets": ["hp", "gold"]`), and the plugin calls `ctx.set(name, value)`. Listing them keeps the story checkable: the compiler checks they exist and reports problems against plugin.json, and anyone reading the manifest can see what the plugin touches. The value must have the type the variable started with.

A change belongs to the line on screen when it's made. `Runner.assign` writes it to the state and to that line's rollback entry, so going back to the line keeps the change and going back before it undoes it, just like a `set` before the line. Screen buttons that `set` now go through `assign` too; before, going back and then forward again could lose their change.

Three things run again whenever the player redraws, so they mustn't change the story: replaying lasting commands after a load or rollback, plugin functions, and drawing elements. In those, `ctx.set` is ignored with a warning instead of throwing, since the plugin can't tell which way it's being called.

`ctx.storage` is a per-plugin JSON object in the device's storage, under the game's key. It persists across saves and playthroughs and isn't touched by rollback. Data that should roll back, or that the story needs to see, belongs in a variable, which keeps the two kinds apart.

The plugin API is a standalone `plugin-api.d.ts` with no imports, which the player's own code uses as well. `emaki plugin <game> <name> [--ts]` scaffolds a plugin and copies the types to `plugins/emaki-plugin.d.ts`, and the dev server, editor and builds keep that copy current. A copy in the game, rather than an npm package, works for games anywhere on disk and needs nothing installed. Arguments are typed loosely (`any`, by name) because the compiler has already checked them against the manifest, which leaves TypeScript plugins free to declare their own types.

## D-067: Windows games export with a WebView2 player and an encrypted pack

An Electron export carries its own Chromium. Gullwing came out at 313 MB, nearly all of it browser, and every patch ships the browser again. Windows 10 and 11 already have a browser engine games can use, kept up to date by Windows: WebView2.

`export desktop` for Windows x64, built on Windows, now makes a WebView2 player: a small .NET Framework program (compiled with the C# compiler Windows ships), Microsoft's WebView2 libraries, and the game in a single `game.emaki` pack. Gullwing comes to 4.7 MB. Games with a `steam_app_id` stay on Electron because Steamworks and the overlay need it, and so do macOS, Linux, Windows on ARM and builds made on another system. `--shell electron|webview2` overrides the choice.

The player gives the page the same `emakiHost` (quit, full screen, achievements kept by the game) and behaves the same way. The window has the game's shape (1280×720 for 16:9, 960×720 for 4:3, in display-independent pixels), its size and full screen are remembered, it handles per-monitor scaling, only one copy runs at a time, links open in the browser, and there's no zoom and no browser keys or menus. On first launch it copies an earlier Electron release's storage into a fresh profile and imports the saves, so players lose nothing when a game switches.

The pack splits each file into 256 KiB chunks, each sealed with AES-256-CBC and an HMAC-SHA256 over its position, IV and ciphertext. The file index is sealed the same way. Keys are new for each build and live in the executable. The player verifies each chunk before decrypting it and serves byte ranges, so movies and music can seek. This stops people browsing or swapping the game's files, and stops casual copying. It can't stop someone who controls the machine, because the key is in the program they're running. The player also clears the `WEBVIEW2_*` environment variables, which would otherwise open a debugging port onto the decrypted game.

Every player ships the WebView2 DLLs, so the exporter pins one SDK version. The NuGet download must match its published SHA-512, every source (download, NuGet cache or `EMAKI_WEBVIEW2_SDK`) must have that version in its DLLs, and Microsoft's license ships with them.

The cost is two desktop shells to keep in step. The shared interface (`emakiHost`) is small, and a CI smoke test plays, saves, reloads and checks the shipped executable. WebView2 updates underneath a shipped game, where Electron pins its engine, so the player sticks to ordinary web features. A few Windows 10 machines don't have the runtime, and for those the player offers Microsoft's installer.

## D-068: Emaki Studio, the launcher as a desktop app

Every tool needed Node 22.18 and git, then a terminal, and that's where most writers stop. The launcher (D-064) already put projects, the editor, the player and exports behind one page served by Node, and Electron is Chromium with Node built in. Electron 45 ships Node 24, which strips TypeScript the same way the CLI's Node does, so the engine's sources run unchanged.

`packages/studio` is an Electron app that starts the launcher in its main process and shows it in a window. The browser tools don't change: `npm run launch`, `dev`, `edit` and the CLI work as before, and the Studio imports `startLauncher` from `@emaki/cli`, so a fix reaches both. The launcher page only gains what a browser tab can't do, through a small bridge (`window.emakiStudio`, launcher window only): the system's folder picker instead of the folder browser. When the bridge is there, the page talks about windows instead of tabs.

Editors and players open in their own windows (the launcher's `window.open` is allowed for the loopback address only). Other addresses are refused in the window, and web and mail links open in the system browser. Pages are sandboxed, with context isolation and no Node. The folder picker only answers the launcher's own page, and pages may only ask for full screen and the clipboard. One Studio runs at a time. Closing the launcher window closes the Studio and stops its servers, previews and exports, asking first if other windows are open.

Exports run the CLI in a child process as before, using `process.execPath`, which inside the Studio is the app itself; `ELECTRON_RUN_AS_NODE` turns it into plain Node for that child (plain Node ignores the variable). Exporting from the Studio turned up a bug the browser launcher had too. The editor's and player's dev servers watched the game's `export` folder, which on Windows holds its folders open, so a second export while the game was open failed with EPERM. They don't watch it any more.

The Studio's launcher uses port 5185 and the browser launcher 5175, so both can run at once. They share `~/.emaki/launcher.json`, so recent projects match. Sessions keep their ports (5173 and 5174, or the next free one).

The Windows package came the same day. `npm run build:studio` stages the engine as it runs from the repository: its packages without tests, the example game, and every package they import at run time, found the way Node finds them and copied from node_modules. That includes Vite, which the tools use but only the root declares, and only Electron's package.json, since Electron exports read its version and download the Electron they package. @electron/packager adds Electron without an asar archive, because Vite, esbuild and the exporters need these as plain files. electron-builder makes a per-user NSIS installer. The folder can be chosen, and if it doesn't end in the app's folder name, that gets added, so uninstalling removes only that folder. The install folder stays writable.

Installers copy files and can't carry npm's links between the engine's packages, which the engine needs: the packages import each other by name and find their files where they really are. So an installed Studio creates the links when it starts, as junctions on Windows, which need no admin rights (src/link.ts). It isn't signed yet, so SmartScreen warns on the first run. It's about 135 MB.

Not done yet: macOS and Linux packages, updates (they need releases on a public page), signing, and recording the engine version in each game. A browser-only playground with nothing to install would need the editor's Vite-only modules behind a file-system layer, and waits until the app is out.

## D-069: `orientation:` decides which way up a game runs

Phone exports rotated with the phone, so an upright phone showed a game drawn on a fixed canvas as a small letterboxed strip (D-018, amended), and authors had no way to keep the app sideways.

The header `orientation:` is `landscape`, `portrait` or `any`. Without it, a game with a `canvas:` is `landscape` and any other game is `any`, so games without a canvas keep the portrait layout on upright phones as before. The web player letterboxes a `landscape` game at its own aspect in any host, since a browser can't rotate the screen.

Phone exports write it into the native projects every time. On Android that's `android:screenOrientation` on the main activity (`sensorLandscape` or `sensorPortrait`, so both ways round work, and nothing for `any`). On iOS it's the supported orientations in Info.plist, plus `UIRequiresFullScreen` on iPad when the game can't rotate every way, which the App Store requires. Writing it on every export makes the header the one place to change it; the rest of the generated project is still left alone. `portrait` only fixes how the app rotates. The game is still drawn wide and uses the portrait layout, as on any tall screen.

We checked it on a real export: the Android project Capacitor generated for a landscape game has `android:screenOrientation="sensorLandscape"` on its main activity. The APK itself didn't build (Capacitor 8 compiles with Java 21 and the machine had 17), so the export now looks for Java 21 (JAVA_HOME, then Android Studio's own, then the PATH) and says what to install instead of failing deep inside Gradle. It also runs Gradle's wrapper by its full path, since Windows can be set not to run programs from the current folder. iOS only builds on a Mac, so the Info.plist rewrite is covered by tests against Capacitor's template.

## D-070: Smaller exports with WebP, Opus and H.264, chosen per game

Exports used to copy `assets/` as it was. Games are often made with lossless pictures and high-bitrate sound and video that players can't tell apart from much smaller files. One 1.9 GB VN demo shipped 870 MB of PNG, 596 MB of Ogg Vorbis and 416 MB of MP4.

The export can now convert three kinds of file, each set separately. Pictures (PNG, BMP) go to WebP, lossless or at a quality. Sound (WAV, FLAC, AIFF, Ogg, MP3) goes to Opus at a bitrate for stereo files; mono files get half, so one setting suits both music and voices. Movies go to H.264 MP4 at a CRF. Each kind is off unless the game turns it on, so no export changes by itself.

The settings live in the game folder's `export.json` (`{"compress": {...}}`). The launcher's Export card writes it and the command reads it, so both build the same thing, and `--images`, `--audio` and `--video` override it for one export. It's a JSON file rather than header keys because the launcher writes it while the editor may have the story open, and because it describes the build, not the story.

Only the export's copy changes. Conversion runs on the finished web build, before the desktop and phone exporters wrap it, so every target benefits. A converted file that's less than 5% smaller is thrown away and the original kept; small UI pictures often grow as WebP. Lossy sound already at or under 1.2× the target bitrate isn't encoded again. Animated PNGs, pictures too big for WebP, and WebM movies (which may have transparency) are left alone. Transparency in pictures is always kept exact (`alphaQuality` 100), so sprite edges don't fringe at any quality.

A file that changes format gets a new name. Rather than rewriting every path in the compiled story (images, voices built from `voice:` templates, screens, translations' localized assets, plugins), the build's game.json lists the renames and the player's single `asset()` function looks each path up. Sound converts into `.ogg`, so Ogg Vorbis files keep their names.

Pictures use sharp (libvips), a dependency of the CLI with prebuilt binaries. Sound and movies need ffmpeg and ffprobe on the PATH, or `FFMPEG_PATH`. We didn't ship ffmpeg at first: it would add tens of megabytes to the Studio and bring GPL x264 into the app's licence, and many writers have it already. (D-071 found a way to ship it.) Without it, those kinds are skipped with a reason, which the launcher shows beside them. Results are cached in `export/.compress-cache` by path, size, modification time and setting, so the next export converts only what changed.

On that demo, with pictures at 90, sound at 96 kbit/s and movies at CRF 23, pictures went from 870 to 115 MB, sound from 596 to 348 MB and movies from 416 to 261 MB: 1.88 GB down to 724 MB. That took 12 minutes the first time and 1 minute with the cache, on 16 threads. 400 small pictures and 8 sound files stayed as they were. The web build played from the title through the first scenes in Chrome with no missing files.

## D-071: Voices on their own, pictures no bigger than the screen, an estimate first, and ffmpeg in the Studio

D-070 left three things for later and asked writers to install ffmpeg themselves.

Speech stays clear at bitrates that would ruin music, and in a voiced game the voices are often most of the sound, so `voice` gets its own setting: 16 to 256 kbit/s, used as is whether the file is mono or not, or `audio` to follow the music and sound setting. A voice is any file the story plays as one: `play voice` paths, the files of a voiced game's lines (`story.voices`) and `sample voice` files on screens, all read from the compiled story, plus any sound file under a folder called `voice` or `voices`, for games that find their voices some other way. Deciding by how the story uses a file, rather than by mono versus stereo, is what makes the setting mean what it says. Without a `voice` setting, as in older settings files, it's `audio`: voices convert exactly as under D-070 and share those cached results, so no export changes. Using half of `audio` for every voice looked like the compatible choice, but one demo's stereo voices would have dropped from 96 to 48 kbit/s.

Big pictures are trickier. A picture's pixels are canvas pixels (`zoom 1` is its own size), so a smaller file would draw smaller. Instead of rewriting placements, the export records each shrunk picture's original size in game.json `sizes`, and the player uses that wherever it sizes a picture by its pixels (free layers, screen pictures, slider knobs). Backgrounds and ordinary sprites are already sized by the screen. A picture is only shrunk while it still covers the screen times the setting in both directions (`max(screenW·f / w, screenH·f / h)`), so panoramas and tall scenes meant to be panned keep every pixel, and shrinks under 5% are skipped as not worth the softening. The setting is a share of the screen (100 to 400%) because the same game gets played on a 1080p laptop and a 4K monitor, and the writer should choose. JPEG and WebP pictures are only resized, never converted, and with `images` off, PNG stays PNG.

The launcher now shows the export's size before it runs. Files already in the cache count exactly. The rest of each kind are sorted by size into bands (32 for pictures and voices, 16 for music and sound, 2 for movies). The middle file of each band is converted, and the others are assumed to shrink by the same ratio. A single ratio per kind was 25% off, because small UI pictures and big backgrounds compress very differently. On the 1.9 GB demo it predicted 710 to 732 MB in about 10 seconds, and the real export was 724 MB. Picture and sound samples go into the cache, so that time isn't wasted. Movies are estimated from a few seconds out of their middle, since encoding a whole movie for a guess would take minutes. The estimate runs in a worker while the Compression section is open, and again after each change.

Finally, the Studio installer now includes ffmpeg: the 6.1.1 essentials build from gyan.dev that ffmpeg-static republishes, with libopus and libx264. The build downloads it, checks it against a pinned SHA-256, and keeps it in `vendor/ffmpeg` with its GPL v3 licence and build notes. It's a separate program the exporter runs, not linked into Emaki, so Emaki's licence is unchanged; the licence file and source commit ship with it. Only ffmpeg ships. Codec, channels, bitrate and length are read from what `ffmpeg -i` prints, so ffprobe isn't needed, which keeps about 30 MB out of the installer. `FFMPEG_PATH` still wins, and outside the Studio ffmpeg comes from the PATH as before.

## D-072: Importing Ren'Py projects

People moving from Ren'Py already have a game, and part of the reason D-006 kept Emaki's script close to Ren'Py's was so the game could come with them. `emaki import renpy <project> <new folder>` (or **Import from Ren'Py…** in the launcher) makes a new Emaki game from a Ren'Py project's `.rpy` sources and files.

Ren'Py scripts are Python underneath, and no importer can run arbitrary Python. The aim is for the story itself (characters, dialogue, choices, conditions, jumps, pictures and sound) to arrive whole, and for everything else to stay visible. Statements with no Emaki equivalent remain in the new script as `# renpy:` comments where they were, and `import-report.md` lists them by reason, file and line. Things that only affect presentation (`window hide`, `what_prefix`, `{size}`) are counted rather than listed, so the report stays readable. A Python condition Emaki can't check becomes `if false:` with the original beside it. A branch that never runs is safer than one that always does, and it's in the report.

The import finishes by compiling the new game, commenting out each line that still fails (with its block), and compiling again, so the writer gets a game that opens rather than a wall of errors. A line of dialogue whose only problem is an expression with no picture keeps its words and loses the expression.

Copying the syntax isn't enough; the behaviour has to match too. Ren'Py labels fall through into the next label and Emaki's end, so a label that doesn't end in `jump` or `return` gets `jump next`. Emaki finds a speaker's picture by their id, so `Character(..., image="sylvie")` takes the id `sylvie`. Image names like `yuri 1a` become identifiers (`yuri _1a`), the same way in declarations and in every `show` and line. Ren'Py draws on a fixed screen at each picture's own size, so the header gets `canvas:` from `gui.init`, and shown pictures become free layers (D-062) at the point, anchor and zoom the game's transforms leave them. Those are read from simple ATL (`xalign`, `xpos`, `xcenter`, anchors, `zoom`, including transforms that call other transforms with numbers). A picture shown without `at` after a `scene` goes where Ren'Py's default would put it. Narration is plain, as in Ren'Py.

Composites of files (`im.Composite`, `LiveComposite`, `Composite`) are rendered to single PNGs at import, because Emaki's layered characters pick layers by attribute while a Ren'Py composite is one fixed combination. They're PNG rather than WebP because writing hundreds of lossless WebPs took minutes, and export compression (D-070) shrinks them anyway. Animated images keep their first frame.

Ren'Py games often let the player name themselves (`DynamicCharacter("player")`, `Character("[player]")`). Character names now fill in `{variables}` when a line is said, so `define mc "{player}"` works in any game. An unknown name is left as written rather than stopping the story.

The importer only reads `.rpy` sources, and refuses a folder that has only `.rpyc` and `.rpa` files. Those are a released game, not a project, and getting scripts back out of them is a different job.

We checked it on a 20,000-line Ren'Py game (35 scripts, 283 labels, about 800 composite sprites, its own position transforms). The import took about 35 seconds, commented out 70 lines that didn't compile (pictures the game draws in Python), and reported the rest of what it skipped. The web export played from the title into the first chapter in Chrome with no missing files or errors, with characters at the game's own positions and sizes.

## D-073: License Emaki under MPL 2.0 before public release

We chose the Mozilla Public License 2.0 so that a distributor of a commercial fork must make the source of the covered engine files, including its changes, available to recipients under the MPL. This file-level protection keeps improvements to Emaki available to the people who receive the fork. Developers can still sell games royalty-free and license their own separate scripts, art, audio, and independently written files on their own terms. See the [license](../LICENSE), sections 3.1 through 3.3.

All engine packages use MPL 2.0. Original game samples under `games/` and starter content emitted by `emaki new` use MIT so developers can reuse scripts, styles, and art in commercial games while retaining the sample notice. Separately credited assets and copies of engine files retain their respective licenses.
