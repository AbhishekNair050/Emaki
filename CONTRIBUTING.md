# Contributing to Emaki

Emaki is an open-source visual novel engine. Its goal is to make visual novel development easier, and it is built in the open with its community.

## Start here
- `docs/getting-started.md`: install, play the demo, start a game. Do this first.
- `docs/decisions.md`: every architectural decision and why. Add an entry when you decide something.
- `docs/script-syntax.md`: the `.vn` language as writers see it.
- `docs/story-format.md`: the compiled JSON contract runtimes implement.
- `docs/roadmap.md`: what's done and what's next.

## Layout
```
packages/format      parser, compiler, expression language, printer, graph  (no deps)
packages/runtime     headless VM: Runner (steps, rollback, save/load, resume) (depends on format)
packages/player-web  DOM player + Vite plugin that compiles story.vn live + story map dev panel (src/map)
packages/cli         emaki new | check | build | graph | fmt | strings | voices | export
packages/desktop     desktop export: app/ is the Electron shell shipped in every game (plain JS), src/ the exporter
packages/mobile      Android/iOS export: generates and syncs a Capacitor project
packages/editor      web editor: script pane (CodeMirror) + game + flowchart; src/server is the Vite plugin that reads/saves story.vn and manages assets/
packages/language    editor features (problems, symbols, definition, references, hover, completion, formatting) and structural edits (src/edits.ts) over plain text
packages/studio      Emaki Studio: Electron app that runs the launcher (@emaki/cli) in its main process; editors and players in their own windows
packages/vscode      VS Code extension: a thin adapter over @emaki/language + TextMate grammar; bundled by esbuild
games/gullwing       demo VN "The Keeper of Gullwing Point" (story.vn + assets/ + tools/gen-art.mjs)
games/plugin-demo    a small game using the example plugins (plugins/weather, memory, meter; see docs/plugins.md)
```

## Commands (run from the repo root)
- `npm test`: vitest, every package. Must stay green.
- `npm run typecheck`: tsc, strict.
- `npm run check`: compile the demo story and report diagnostics.
- `npm run fmt` / `npm run fmt:check`: format the demo story / verify it is formatted.

CI (`.github/workflows/ci.yml`) runs all of these, the demo build, the VS Code extension build and a web export on every push and pull request.

Other commands:
- `npm run launch`: the local project launcher (recent games, new/open, editor/player sessions, web/desktop export). `npm run emaki -- edit <game>` / `play <game>` launch a game directly without environment variables.
- `npm run strings -- --lang fr`: create/update a translation of the demo (lang/fr.po).
- `npm run export -- <web|desktop|android|ios> games/gullwing`: package the demo (into games/gullwing/export/).
- `npm run edit`: the editor on the demo (edits games/gullwing/story.vn; `EMAKI_GAME=...` for another game).
- `npm run dev`: play the demo with live reload (edit story.vn and it resumes at the same line).
- `npm run build:demo`: static build to games/gullwing/dist (itch.io-ready).
- `npm run build:vscode`: bundle the VS Code extension (the one package with a build step, because VS Code can't run .ts).
- `npm run emaki -- graph games/gullwing/story.vn`: Mermaid flowchart.
- `npm run art`: regenerate the demo's placeholder SVGs.
- `VSCODE_PATH=/path/to/Code npm run test:e2e -w emaki-vscode`: drive the extension in a real VS Code (needs a desktop, so not in CI).

## Release Emaki Studio for Windows

Set the release version in `packages/studio/package.json` and update the lockfile if the version changes. Merge the release commit, then push an annotated tag matching that version. For Studio 0.1.0:

```sh
git tag -a studio-v0.1.0 -m "Emaki Studio 0.1.0"
git push origin studio-v0.1.0
```

The [Studio release workflow](.github/workflows/studio-release.yml) runs on Studio version tags. It builds and smoke-tests the Windows x64 installer, then publishes it to GitHub Releases. Its release notes come from [.github/studio-release-notes.md](.github/studio-release-notes.md).

## Reporting bugs and proposing features
Use the issue templates. For a bug in a story, the smallest script that shows it is the most useful thing you can include. A new feature should come from a game that needs it: say what you're making and what you couldn't write. Larger changes are best discussed in an issue before a pull request, since the script language and the compiled format are shared contracts (see Conventions). Security problems go privately: see [SECURITY.md](SECURITY.md).

By contributing you agree that your contributions are licensed under the MIT License, and to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

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
