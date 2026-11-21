# Security

## Reporting a vulnerability
Report security problems privately through **Security → Advisories → Report a vulnerability** on GitHub. Include what an attacker could do and the steps or a small game that shows it.

You'll get a reply within a week. Once it's fixed, the fix and its credit (if you'd like it) go in the changelog.

## Supported versions
Security fixes are developed on `main`. Windows Studio users should use the latest release.

## What's in scope
The parts that run in players' hands matter most:

- **The web player** (`packages/player-web`), and anything a story, translation file or save can make it do. Scripts can't run code: expressions and screens have a fixed set of operations, and text is never inserted as HTML.
- **The desktop app shell** (`packages/desktop/app`): the window is sandboxed with context isolation and no Node in the page, serves only files inside the game, and opens outside links in the browser. Ways around any of that are in scope.
- **Exports** (`emaki export`): files that end up in a game that shouldn't.
- **Saves**: a save file that can do more than restore a game.

The dev server and the editor (`npm run dev`, `npm run edit`) are tools for your own machine. They listen on localhost only and the editor writes to the game folder, so don't expose them to a network (for example with `--host`). Problems that need that are still worth reporting, but are lower priority.

## Plugins
A game's plugins (`plugins/<name>/index.js`) are ordinary JavaScript with the same trust as the game itself; there is no sandbox (see [Plugins](docs/plugins.md)). A plugin doing something harmful isn't a vulnerability in Emaki, but a way for *story content* (a script, a translation, a save) to make a plugin do something it shouldn't is.
