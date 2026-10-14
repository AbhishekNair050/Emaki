# Decisions log

Short records of decisions that shape the project. Newest at the bottom. Status: **accepted**, **provisional** (revisit soon), or **superseded**.

---

### D-001 — Name: Emaki (accepted)
*Emaki* (絵巻, "picture scroll", pronounced eh-MAH-kee) are Japanese illustrated handscrolls from the 12th century onward: pictures and text read scene by scene as the scroll unrolls. They are an ancestor of the visual novel, a story told through pictures and words, one scene at a time.
Short, meaningful, rarely used in software, and works as a CLI name (`emaki`), a package scope (`@emaki/*`) and a "Made with Emaki" credit. Chosen over Lantern (too generic), Benshi, Kamishibai, Limn and Quire. Formal trademark checks are deferred.

### D-002 — License: MIT, no royalty on the core (accepted)
The engine, editor and exports are free forever. Ren'Py is free and MIT, so any fee on the core would be a reason not to switch, and royalties can't be enforced on OSI-licensed code anyway. If paid offerings ever exist, they will be optional services around the engine (for example console-port support or cloud builds), never a tax on the core or on games made with it.

### D-003 — TypeScript for everything in v0 (accepted)
Biggest contributor pool, the editor is a web-UI problem, and web/mobile become native targets instead of ports (Ren'Py's weakest areas). Consoles later via a native player that implements the compiled format (D-005).

### D-004 — No build step: Node type stripping + `.ts` imports (accepted)
Node ≥22.18 runs `.ts` directly; Vite and Vitest handle the same files. Packages export `src/index.ts`. Constraint: erasable TypeScript only (no enums/parameter properties/namespaces). Revisit if we publish to npm (we'd add a build that emits `.js` + `.d.ts`).

### D-005 — Compile to a portable JSON instruction list (accepted)
Source `.vn` → AST → flat instruction array with resolved jump targets + expression trees as JSON. Any runtime (TS today, Rust/C++ for consoles later) implements ~14 opcodes and a tiny expression evaluator. Spec: docs/story-format.md. Versioned by `FORMAT_VERSION`.

### D-006 — Screenplay-style, indentation-based syntax close to Ren'Py (accepted)
Writers already know Ren'Py; it makes the planned Ren'Py importer easy. Differences from Ren'Py, on purpose:
- Dialogue text is **unquoted** (`mira: Hello.`), like a screenplay. Quotes are optional.
- `set x += 1` instead of `$ x += 1`: no embedded Python; a small sandboxed expression language (`and`/`or`/`not`).
- Variables must be declared (`var trust = 0`) so typos are caught at compile time.
- Reaching the end of a label **returns** (or ends the story) instead of falling through into the next label. Fall-through is a classic Ren'Py bug source.

### D-007 — Sandboxed expression language, not JavaScript (accepted)
Portable to native runtimes, can't touch the host, statically analysable (free variables → typo detection, reachability). Escape hatch for power users will be a plugin API, not inline code.

### D-008 — Stable line ids = label + hash(speaker|text) (provisional)
Used for localization keys, live-reload resume, and (later) save robustness. Editing a line changes its id, which is correct for translation ("this line changed, re-translate"). Duplicates in the same label get a `.2` suffix. Revisit: optional explicit ids (`#id`) for lines writers want to pin.

### D-009 — Runtime is a headless VM producing Steps (effects + one blocking event) (accepted)
DOM-free so it's testable in Node and reusable by any renderer. Rollback = snapshot per blocking event (bounded, 500). Saves = full state snapshot + story hash. Live-reload `resume()` relocates by line id when the story changed.

### D-010 — DOM/CSS renderer first, WebGL later (accepted)
v0 player is plain DOM: accessible, crisp text, tiny (≈13 KB gzipped incl. engine). The Effect/Block contract lets a PixiJS/WebGL renderer drop in later for shaders/particles without touching the VM.

### D-011 — Sprite attributes replace, they don't merge (provisional)
`show mira smile` then `mira sad: ...` → attrs become `[sad]`. Simpler than Ren'Py's attribute merging; revisit when layered sprites (outfit + expression) arrive.

### D-012 — Comments are full-line `#` only (accepted)
Inline comments would conflict with dialogue text containing `#` ("mira: Room #4"), so a comment is always a whole line. Comments are preserved by the formatter; see D-015.

### D-013 — The story map is a dev-only tool (accepted)
The flowchart of scenes, play-from-here and live variable editing exist to help writers test routes. They are loaded lazily on the dev server only: the Vite plugin emits the story graph only when serving, and the map module sits behind `import.meta.env.DEV`, so published games never ship a spoiler map of their own routes or the extra code. A player-facing route chart (as some VNs offer after completion) would be a separate, opt-in feature.

### D-014 — Flowchart layout is home-grown, not a dependency (accepted)
A small Sugiyama-style layered layout (back-edge detection, longest-path layering, barycenter ordering) in `player-web/src/map/layout.ts`. Story graphs are small (tens to a few hundred labels), so a ~200-line pure function beats pulling in dagre/elkjs. It is DOM-free and tested, so the future editor can reuse it. Revisit if large stories need better edge routing.

### D-015 — Comments and blank lines live in the AST as "leading trivia" (accepted)
Every node (declaration, label, statement, menu choice, elif/else branch) can carry `leading: string[]`: the comments ("# ...") and blank lines ("") written directly above it. Comments after the last line go in `Program.trailing`. The printer writes them back, so the formatter and the future visual editor never lose a writer's notes.
The AST is kept canonical so `parse(print(ast))` equals `ast`: consecutive blank lines collapse to one, and a blank line is dropped where the printer always puts one anyway (start of a block, before each label, before the first item of each declaration group). Canonical files round-trip byte for byte (`print(parse(text)) === text`), and CI checks the demo with `emaki fmt --check`.
A comment attaches to the next line regardless of its indentation, so a note left at the end of a block moves to the line after the block when formatted. Simple and predictable; revisit if writers find it surprising.

### D-016 — Text styling is Markdown-like and compiled into spans (accepted)
`*italic*`, `**bold**` and `[color=...]...[/color]`, because writers already know Markdown, and square-bracket tags can't clash with `{variable}` interpolation. Markup is parsed at compile time: instructions keep plain `text` and gain optional `spans`, so the format change is additive (`FORMAT_VERSION` stays 1) and a variable's value can never be mistaken for markup. Unbalanced markers are errors, not guesses. Quoted strings keep unknown backslash escapes such as `\*`, so escaping works the same quoted or unquoted.

### D-017 — Player settings are per game, validated, and applied through CSS variables (accepted)
Text speed, auto-advance wait, volumes, text size, text box opacity, font and animations. Stored in localStorage per game title; every value is clamped or defaulted on load, so a bad stored value can't break the player. Visuals are driven by CSS variables and classes on the stage, so themes can restyle without touching code. "Animations: follow my device" is the default, respecting `prefers-reduced-motion`.

### D-018 — The stage adapts to its host: 16:9 letterbox when wide, full-screen portrait when tall (accepted)
The player marks the element it mounts into as a CSS size container and lays out from the host's shape, not the window's, so the dev story map, an embed or a phone all behave the same. Hosts taller than 4:5 get the portrait layout: the stage fills the host, backgrounds crop to the centre, characters stand above a full-width textbox, and the quick menu sits below it in one row. Everything inside sizes off one unit, `--u` (1% of stage height in landscape; tied to the width in portrait), and sprite positions are CSS variables (`--pos-left/center/right`), so a theme can retune either layout without code. Games are still authored for 16:9; per-image focal points for portrait cropping can come later.

