# Writing tools

Emaki's tools all read the same script and report the same problems, so use whichever suits you: the web editor, VS Code, or any text editor with the dev server.

## The project launcher
Run `npm run launch` to open the project manager in your browser. Create a game with **New project**, or use **Open…** and browse to a folder containing `story.vn`. **Try the example game** adds the bundled demo to the list.

Each project shows its picture (the `title_image`, else the background of its own `screen title`, else its first scene), how big it is (scenes, words, choices, endings, files and lines) and whether it has problems, with the first one spelled out, the same check as `emaki check`. A long game takes a few seconds to read the first time; this happens in the background, and again only when a story file changes. **Open editor** opens the editor in the workspace chosen beside it (**Write**, **Stage** or **Story**); **Play in a browser tab** runs the game on its own. **Export** builds it for the web, the desktop, Android or iOS (the last two make projects for Android Studio and Xcode; see [exporting](exporting.md)).

Editor and player sessions open in separate tabs. Reopening a session reuses its server; use **Stop** in the launcher to close it. Keep the launcher terminal open: Ctrl+C stops the launcher and all its sessions. Closing a browser tab alone does not stop a session. Recent projects are stored in `~/.emaki/launcher.json`; removing one from the list never deletes the game. Missing or moved folders stay listed until you remove or reopen them.

`npm run emaki -- launch --port 5180` selects a different launcher port. Add `--no-open` to print the address without opening a browser. The launcher runs locally and requires the same Node installation as the other tools; it is not yet a standalone desktop application.

## The editor
`npm run edit` opens the editor in your browser (http://localhost:5174). For your own game: `EMAKI_GAME=../my-game npm run edit` (in PowerShell: `$env:EMAKI_GAME="../my-game"; npm run edit`).

Every panel follows the same place: the scene and line the cursor is on, shown in the bar at the top (with the chosen route). The **scenes** are listed on the left, the **inspector** is on the right, and the scene's **lines** run along the bottom; the middle depends on the workspace, switched at the top or with **Alt+1/2/3**: **Write** (the script and the game), **Stage** (the game large, with staging tools) or **Story** (the whole story as a flowchart). Switching keeps the game running. ▶ at the top plays from the cursor's line, and the arrows beside it go to the previous and next line of the scene.

- **Route to** (left, under the scenes): Emaki plays the story in the background, trying every choice, and finds a way to each ending, listed with the conditions that lead there. Pick one and it becomes the route the editor plays by: playing from any line, in any workspace, starts with the variables that route has there (a line after a choice sees what the choice set), its scenes are marked in the list and on the flowchart, and the inspector shows the variables at the cursor. An ending no choice reaches is marked *never reached*. The search runs again when you open Story, or with **Search again**. Click **Route to** to fold it away and give the scene list the whole height.
- The **inspector** shows the line under the cursor: a character's look (as pictures), place, size, turn and transition, a scene's background, the look a speaker has while talking, the line as written, and the variables there. A change rewrites only that line, keeps its comment, and can be undone with Ctrl+Z. In Story it shows the scene instead: its picture, words and lines, the values each variable can have as it starts, what it sets, how much of it you've seen while testing, and the choice the chosen route makes there, with **Open on stage** and **Open in script**. Hide the inspector with its **×** (or **Alt+I**, or the panel button at the top right) to give its width to the middle; the same button or key brings it back.
- The **lines** along the bottom: one column for each line of dialogue or choice, with a track for each character on stage (their look and place), the background, the music and where the story branches. Click a column to go to that line.
- In **Stage** the game follows the cursor: rest on a line and it shows that moment. Click a character to pick them, then drag to **Move** them (snapping to left, center and right), **Scale** them (drag up or down) or **Rotate** them (drag sideways): the `show` line that put them there gets `at 33%`, `zoom 1.2` or `rotate 10`. **Thirds and safe area** draws guides over the picture. A click anywhere else plays the game on.
- Move around the flowchart as in a design tool: drag the background (or hold **Space**, or the middle button) to pan, scroll to pan (**Shift**+scroll sideways), and **Ctrl**+scroll or pinch to zoom on the pointer. The buttons at the bottom right zoom out and in, go back to 100% and **Fit** the whole story (also **Ctrl+−**, **Ctrl+=**, **Ctrl+0** and **Shift+1** with the pointer over the chart). Only the chart moves: the page never zooms.
- In **Story**, colour the scenes by **Playtest coverage**, **Word count** or the value of a variable (`trust 0 to 2`). Shape the story in the flowchart: add, rename and delete scenes, and drag from one scene to another to connect them (connecting a scene that already leads somewhere turns it into a choice). The script is rewritten cleanly, comments kept, and Ctrl+Z undoes it.
- Type and the game updates in place: same line, same music, your edit on screen. While the script has errors the game keeps running the last version that worked.
- **Ctrl+Enter** plays from the line the cursor is on. Click a scene in the list or the flowchart to find it in the script; double-click one in the flowchart to play it.
- The line the game is showing is marked in the script, its scene in the flowchart, and its column in the lines along the bottom, which follow the game from scene to scene as you click through (and go back to the cursor's scene when the cursor moves). With the cursor inside a `screen` block, the game shows that screen.
- The **Assets** tab (beside Scenes, on the left) shows the game's images and audio. Drag one onto the script and it's declared for you, with a `scene`, `show` or `play` line placed where you dropped it. Drop files from your computer to add them to the game (they're copied into `assets/`, never overwriting anything).
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
| `launch [--port 5175] [--no-open]` | The project manager: recent games with their picture, size and problems; new/open, editor, play and export. |
| `edit <game folder> [--no-open]` | Open the editor for a game, without environment variables. |
| `play <game folder> [--no-open]` | Play a game with live reload, without environment variables. |
| `new <folder> [--title "Name"]` | Start a game: a short story that runs as it is. |
| `plugin <game folder> <name> [--ts]` | Start a plugin: `plugins/<name>/` with a command that works as it is, and the plugin API's types. See [Plugins](plugins.md). |
| `check <story.vn>` | Every problem in the story (and its plugins), with line numbers. |
| `fmt <story.vn> [--write \| --check]` | Tidy the layout, keeping comments and blank lines. |
| `graph <story.vn>` | The story's scenes as a Mermaid flowchart. |
| `build <story.vn> [out.json]` | The compiled story (see [Story format](story-format.md)). |
| `strings <story.vn> [--lang fr,de] [--csv]` | Create or update translation files in `lang/`; without `--lang`, how far each translation is. See [Translations](script-syntax.md#translations). |
| `voices <story.vn>` | The recording script (`voice-script.csv`) and which voice files are missing. See [Voiced games](script-syntax.md#voiced-games). |
| `export <web\|desktop\|android\|ios> <game folder>` | Package the game for players. See [Exporting](exporting.md). |
