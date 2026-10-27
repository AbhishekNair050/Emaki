# Emaki

*Unroll your story. Write like a screenplay, ship everywhere.*

An open-source (MIT) visual novel engine. Early days, but you can already write a story, edit it visually, translate it, and ship it to the web, desktop (with Steam achievements) and phones.

> **Emaki** (絵巻, *eh-MAH-kee*) are Japanese illustrated handscrolls, pictures and words read scene by scene as the scroll unrolls. They're one of the oldest ancestors of the visual novel.

```
label arrival:
  scene cliff_road with fade
  show mira neutral at center with dissolve
  mira: You're early. Nobody's ever early.

  menu:
    "I wanted to see the light come on.":
      set trust += 1
      mira smile: Did you now.
    "The driver wanted to beat the storm.":
      mira: Smart man.
```

## Try it

Requires Node 22.18+.

```sh
npm install
npm run edit         # the editor: script, game and flowchart side by side (http://localhost:5174)
npm run dev          # play the demo; edit games/gullwing/story.vn and it reloads at the same line
npm test             # run the test suite
npm run check        # lint the demo story
npm run fmt          # format the demo story (keeps comments)
npm run build:demo   # static build in games/gullwing/dist (upload to itch.io as HTML)
npm run export -- desktop games/gullwing   # Windows/macOS/Linux app (also: web, android, ios)
npm run strings -- --lang fr               # start or update a French translation of the demo
npm run build:vscode # the VS Code extension (see packages/vscode)
```

CLI: `npm run emaki -- check|build|graph|fmt <file.vn>`

### The editor
`npm run edit` opens the editor in your browser: the script on the left, the game and a flowchart of the story on the right, always pointing at the same place.

- Type and the game updates in place: same line, same music, your edit on screen. While the script has errors the game keeps running the last version that worked.
- **Ctrl+Enter** plays from the line the cursor is on. Click a scene in the flowchart to find it in the script; double-click to play it.
- The line the game is showing is marked in the script, and its scene in the flowchart.
- Shape the story in the flowchart: add, rename and delete scenes, and drag from one scene to another to connect them (connecting a scene that already leads somewhere turns it into a choice). The script is rewritten cleanly, comments kept, and Ctrl+Z undoes it.
- The **Assets** tab shows the game's images and audio. Drag one onto the script and it's declared for you, with a `scene`, `show` or `play` line placed where you dropped it. Drop files from your computer to add them to the game (they're copied into `assets/`, never overwriting anything).
- Errors are underlined as you type, with completion, hover, go to definition (F12 or Ctrl+click) and formatting (Shift+Alt+F), the same features as the VS Code extension.
- Saves to `story.vn` by itself. If the file changes elsewhere (VS Code, git) the editor loads it, and if you both changed it, it asks which version to keep rather than overwriting anything.

To edit another game: `EMAKI_GAME=path/to/game npm run edit`.

### Ship it
`npm run export -- desktop games/mygame` makes a Windows, macOS or Linux app (Electron), with Steam achievements if you add `steam_app_id` to the header. `android` and `ios` make phone apps (Capacitor), and `web` makes a site for itch.io. See [Exporting](docs/exporting.md).

### Translate it
`npm run emaki -- strings games/mygame/story.vn --lang fr,ja` writes `lang/fr.po` and `lang/ja.po` (or `.csv` with `--csv`) with every line, choice, name and button. Translators fill them in with any PO tool or a spreadsheet; the game picks them up, and players switch language in Settings. Run it again after editing the story: translations are kept, and changed lines come back marked for review.

### Story map
While `npm run dev` is running, a **story map** sits beside the game: every scene as a flowchart, with where you are highlighted. Click any scene to play from it, and edit your story's variables live to test other routes (set `trust` to 2, jump to the last scene, see which ending you get). Press `M` to show or hide it. It is a development tool only and is never included in a published build.

### Preview from any line
Add `?line=52` to the dev server address to start the game at line 52 of `story.vn`, with the right background, characters and music already in place. Set variables the same way: `?line=52&trust=2&read_letter=true`. In VS Code, put the cursor on a line and press **Ctrl+Alt+Enter** (or click ▷ in the editor title bar): the game opens beside your script at that line.

### Phones
The same build plays on phones. Turned sideways it's the usual 16:9 picture; held upright, the game fills the screen with the textbox and menu sized for thumbs. To try it on a desktop, open your browser's device toolbar (F12, then Ctrl+Shift+M in Chrome).

## What's here
- **[Script syntax](docs/script-syntax.md)**: how to write a story
- **[Story format](docs/story-format.md)**: the compiled JSON any runtime can play
- **[Theming](docs/theming.md)**: title screen, `theme.css`
- **[Exporting](docs/exporting.md)**: web, desktop, Steam, Android and iOS
- **[Decisions](docs/decisions.md)**: why things are the way they are
- **[Roadmap](docs/roadmap.md)**

| Package | |
|---|---|
| `@emaki/format` | parser, compiler, expressions, printer, story graph (no dependencies) |
| `@emaki/runtime` | headless story VM: rollback, saves, live-reload resume |
| `@emaki/player-web` | browser player (DOM, accessible, phone-friendly, ~15 KB gzipped) |
| `@emaki/editor` | the web editor (`npm run edit`) |
| `@emaki/language` | editor features over plain text, shared by the editor and the VS Code extension |
| `@emaki/cli` | `check`, `build`, `graph`, `fmt`, `strings`, `export` |
| `@emaki/desktop` | desktop export (Electron shell, Steamworks) |
| `@emaki/mobile` | Android and iOS export (Capacitor) |
| [`emaki-vscode`](packages/vscode) | VS Code extension: highlighting, live errors, go to definition, completion, formatting |

The demo, *The Keeper of Gullwing Point*, is a short original story with three endings. Its placeholder art is generated by `games/gullwing/tools/gen-art.mjs`; its music and sounds are CC0 recordings, credited in [`assets/audio/CREDITS.md`](games/gullwing/assets/audio/CREDITS.md).

## License
MIT
