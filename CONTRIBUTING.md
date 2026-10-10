# Contributing to Emaki

Emaki is an open-source visual novel engine. Its goal is to make visual novel development easier, and it is built in the open with its community.

## Start here
- `docs/decisions.md`: every architectural decision and why. Add an entry when you decide something.
- `docs/script-syntax.md`: the `.vn` language as writers see it.
- `docs/story-format.md`: the compiled JSON contract runtimes implement.
- `docs/roadmap.md`: what's done and what's next.

## Layout
```
packages/format      parser, compiler, expression language, printer, graph  (no deps)
packages/runtime     headless VM: Runner (steps, rollback, save/load, resume) (depends on format)
packages/player-web  DOM player + Vite plugin that compiles story.vn live + story map dev panel (src/map)
packages/cli         emaki check | build | graph | fmt
games/gullwing       demo VN "The Keeper of Gullwing Point" (story.vn + assets/ + tools/gen-art.mjs)
```

## Commands (run from the repo root)
- `npm test`: vitest (format + runtime). Must stay green.
- `npm run typecheck`: tsc, strict.
- `npm run check`: compile the demo story and report diagnostics.
- `npm run dev`: play the demo with live reload (edit story.vn and it resumes at the same line).
- `npm run build:demo`: static build to games/gullwing/dist (itch.io-ready).
- `npm run emaki -- graph games/gullwing/story.vn`: Mermaid flowchart.
- `npm run art`: regenerate the demo's placeholder SVGs.

## Conventions
- TypeScript runs directly in Node (type stripping): **no enums, no parameter properties, no namespaces**
  (`erasableSyntaxOnly`). Import with explicit `.ts` extensions. Packages have no build step.
- `format` must stay dependency-free and DOM-free. `runtime` must stay DOM-free.
- The compiled format is a public contract. Changing it means bumping `FORMAT_VERSION` and logging a decision.
- The parser never throws on user input. It records a Diagnostic (line + code + friendly message) and continues.
  Error messages are written for writers, not programmers, and should suggest the fix.
- Every runtime feature gets a test in `packages/runtime/test`. Every syntax feature gets a parser test
  and must survive the printer round-trip test.
- The demo story must keep all endings reachable (tested in `runner.test.ts`).
- No generative-AI assets or features in core; the visual novel community values human-made work. Placeholder art is hand-coded SVG.
- Keep player-web accessible: real buttons, keyboard controls, aria-live for dialogue, reduced motion respected.

## Commits
Small and focused, with a [Conventional Commits](https://www.conventionalcommits.org/) prefix:
`feat(format): ...`, `fix(player-web): ...`, `docs: ...`, `test(runtime): ...`, `chore: ...`.
