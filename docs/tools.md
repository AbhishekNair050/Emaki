# Writing tools

Emaki's tools all read the same script and report the same problems, so use whichever suits you: the web editor, VS Code, or any text editor with the dev server.

## The editor
`npm run edit` opens the editor in your browser (http://localhost:5174): the script on the left, the game and a flowchart of the story on the right, always pointing at the same place. For your own game: `EMAKI_GAME=../my-game npm run edit` (in PowerShell: `$env:EMAKI_GAME="../my-game"; npm run edit`).

- Type and the game updates in place: same line, same music, your edit on screen. While the script has errors the game keeps running the last version that worked.
- **Ctrl+Enter** plays from the line the cursor is on. Click a scene in the flowchart to find it in the script; double-click to play it.
- The line the game is showing is marked in the script, and its scene in the flowchart. With the cursor inside a `screen` block, the game shows that screen.
- Shape the story in the flowchart: add, rename and delete scenes, and drag from one scene to another to connect them (connecting a scene that already leads somewhere turns it into a choice). The script is rewritten cleanly, comments kept, and Ctrl+Z undoes it.
- The **Assets** tab shows the game's images and audio. Drag one onto the script and it's declared for you, with a `scene`, `show` or `play` line placed where you dropped it. Drop files from your computer to add them to the game (they're copied into `assets/`, never overwriting anything).
- Errors are underlined as you type, with completion (including your plugins' commands and functions), hover, go to definition (F12 or Ctrl+click) and formatting (Shift+Alt+F), the same features as the VS Code extension.
- Saves to `story.vn` by itself. If the file changes elsewhere (VS Code, git) the editor loads it, and if you both changed it, it asks which version to keep rather than overwriting anything.

## VS Code
The [Emaki extension](../packages/vscode/README.md) adds highlighting, errors as you type, completion, go to definition, references, hover, outline and formatting for `.vn` files, and checks your plugins' commands against their `plugin.json`. It isn't on the Marketplace yet; it installs from this repository.

## The dev server
`npm run dev` plays the demo; `EMAKI_GAME=../my-game npm run dev` plays your game. Save the script in any editor and the game reloads at the same line, with the same music.

### Story map
While the dev server is running, a **story map** sits beside the game: every scene as a flowchart, with where you are highlighted. Click any scene to play from it, and edit your story's variables live to test other routes (set `trust` to 2, jump to the last scene, see which ending you get). Press `M` to show or hide it. It's a development tool only and is never included in a published build.

### Preview from any line
Add `?line=52` to the dev server address to start the game at line 52 of `story.vn`, with the right background, characters and music already in place (`&file=chapters/two.vn` for another file of the story). Set variables the same way: `?line=52&trust=2&read_letter=true`. In VS Code, put the cursor on a line and press **Ctrl+Alt+Enter** (or click ▷ in the editor title bar): the game opens beside your script at that line.

### Phones
The same build plays on phones. Turned sideways it's the usual 16:9 picture; held upright, the game fills the screen with the text box and menu sized for thumbs. To try it on a desktop, open your browser's device toolbar (F12, then Ctrl+Shift+M in Chrome).

## The command line
Run from the Emaki folder as `npm run emaki -- <command>`:

| Command | |
|---|---|
| `new <folder> [--title "Name"]` | Start a game: a short story that runs as it is. |
| `check <story.vn>` | Every problem in the story (and its plugins), with line numbers. |
| `fmt <story.vn> [--write \| --check]` | Tidy the layout, keeping comments and blank lines. |
| `graph <story.vn>` | The story's scenes as a Mermaid flowchart. |
| `build <story.vn> [out.json]` | The compiled story (see [Story format](story-format.md)). |
| `strings <story.vn> [--lang fr,de] [--csv]` | Create or update translation files in `lang/`; without `--lang`, how far each translation is. See [Translations](script-syntax.md#translations). |
| `voices <story.vn>` | The recording script (`voice-script.csv`) and which voice files are missing. See [Voiced games](script-syntax.md#voiced-games). |
| `export <web\|desktop\|android\|ios> <game folder>` | Package the game for players. See [Exporting](exporting.md). |
