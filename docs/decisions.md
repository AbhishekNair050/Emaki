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

### D-012 — Comments are full-line `#` only; formatter drops them (provisional)
Inline comments conflict with dialogue text containing `#`. The printer doesn't preserve comments yet — must fix before the visual editor writes files (the round-trip promise includes comments).
