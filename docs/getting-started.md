# Getting started

From nothing to your own game playing in the browser, in about ten minutes.

## 1. Install

**Windows x64:** Download `Emaki-Studio-Setup-*.exe` from [GitHub Releases](https://github.com/AbhishekNair050/Emaki/releases). The installer is unsigned, so Windows may show a SmartScreen warning. Open Emaki Studio from the Start menu. Studio includes its own Node runtime.

**macOS and Linux:** Run from source. The same steps also work on Windows. Install [Node.js](https://nodejs.org/) 22.18 or newer and [git](https://git-scm.com/).

```sh
git clone https://github.com/AbhishekNair050/Emaki.git
cd Emaki
npm install
```

Open the project launcher:

```sh
npm run launch
```

It opens in your browser (usually http://127.0.0.1:5175). Keep the terminal open while working; Ctrl+C stops the launcher and its editor/player sessions.

Choose **New project**, enter your game's title and location, then **Create project**. Select **Open editor** to write with the game running beside your script, or **Play** to open the game on its own. **Try the example game** opens *The Keeper of Gullwing Point* in the project list.

Use **Open…** for a game you already have: paste its folder path or use **Browse** to find the folder containing `story.vn`. Recent projects are remembered between launcher sessions. Removing a project from the list does not delete its files.

The rest of this guide also shows the terminal commands, if you prefer those.

## 2. Start your game

```sh
npm run emaki -- new ../my-game
```

This makes a folder with a short story that already runs:

```
my-game/
  story.vn          your script
  theme.css         your game's look (empty for now)
  assets/
    bg/sky.svg      a background
    sprites/        character pictures go here
    audio/          music and sounds go here
```

The game can live anywhere; keeping it outside the Emaki folder keeps your work separate from the engine's, so you can update Emaki with `git pull` without touching it. Add `--title "My Game"` to give it a name (otherwise it's named after the folder).

## 3. Play it while you write

Point the dev server at your game:

```sh
npm run emaki -- play ../my-game
npm run emaki -- edit ../my-game
```

These commands open the player or editor in your browser, without changing environment variables. Paths with spaces should be quoted. Add `--no-open` to print the address without opening a browser.

The original development commands also work:

```sh
# macOS, Linux, Git Bash
EMAKI_GAME=../my-game npm run dev

# Windows PowerShell
$env:EMAKI_GAME="../my-game"; npm run dev
```

Open `story.vn` in any text editor, change a line and save: the game reloads at the same line. Errors show in the game and in the terminal, with the line number and a suggested fix.

Or use the **editor**, which has the script, the game and a flowchart of your story side by side, and saves as you type: the same command with `npm run edit` (http://localhost:5174).

If you use VS Code, install the [Emaki extension](../packages/vscode/README.md) for highlighting, errors as you type, completion and "play from this line".

## 4. Write

Open `story.vn`. A script has a header between `---` lines, then declarations, then labels (scenes) with the story indented under them:

```
---
title: My Game
start: start
---

define ava "Ava" color=#e8b04b        # a character: short id, shown name, colour

image sky = "bg/sky.svg"              # pictures, from assets/
image ava smile = "sprites/ava_smile.png"

var curious = 0                       # a variable, for choices that matter later

label start:
  scene sky with fade                 # a background
  show ava smile at center            # a character
  "Narration is a quoted line."
  ava: Dialogue is a speaker, a colon and the line.
  menu:
    "Ask her.":
      set curious += 1
      ava: Good question.
    "Say nothing.":
      ava: Fair enough.
  if curious > 0:
    ava: I'm glad you asked.
```

[Script syntax](script-syntax.md) covers everything else: music and sound, transitions, text styling, character moves, full-screen text, voices, endings, achievements and more.

## 5. Add your pictures and sounds

Put files in `assets/` (any folders you like), then declare them by name:

```
image cafe = "bg/cafe.jpg"
image ava sad = "sprites/ava_sad.png"
audio rain = "audio/rain.ogg"
```

Characters' pictures are named after the character (`ava smile`, `ava sad`), so `ava sad: I see.` switches her expression as she speaks. In the editor, you can also drag files from your computer onto the **Assets** tab, and drag an asset onto the script to declare and use it.

## 6. Check and tidy

```sh
npm run emaki -- check ../my-game/story.vn         # every problem, with line numbers
npm run emaki -- fmt ../my-game/story.vn --write   # tidy the layout (keeps your comments)
```

## 7. Make it yours, then ship it

- **[Theming](theming.md)**: your own title screen, text box, menus and save screens, and styles in `theme.css`.
- **[Translations](script-syntax.md#translations)**: `npm run emaki -- strings ../my-game/story.vn --lang fr` makes a file for translators.
- **[Plugins](plugins.md)**: your own JavaScript for what the script doesn't do (minigames, effects, HUD elements).
- **[Exporting](exporting.md)**: `npm run export -- web ../my-game` for itch.io, `desktop` for Windows, macOS and Linux (with Steam achievements), `android` and `ios` for phones.

Stuck, or found a bug? [Open an issue](https://github.com/AbhishekNair050/Emaki/issues).
