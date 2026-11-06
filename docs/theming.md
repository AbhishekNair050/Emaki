# Theming your game

Your game can look like itself, not like every other Emaki game. Pick whichever level fits: each works without the others.

## 1. Title screen settings (header)
```
---
title: The Keeper of Gullwing Point
title_image: cliff_road          # background: an image name or a path in assets/
title_music: theme               # music: an audio name or a path
title_logo: ui/logo.png          # an image shown instead of the title text
title_layout: left               # where the title and buttons sit: center (default), left, right, bottom
title_buttons: start, settings   # built-in buttons and their order (default: start, load, extras, settings, quit)
---
```
Load only appears when there are saves, Extras only when the story has gallery images, endings or achievements, and Quit only in desktop and phone apps.

## 2. A scripted title screen (`label title`)
Give your story a label named `title` and it *is* the title screen. It plays like any other scene (backgrounds, characters, music, opening lines such as a content warning), and its `menu:` becomes the title menu:

```
label title:
  scene cliff_road with fade
  play music theme
  "This story contains scenes some players may find distressing."
  menu:
    "New game":
      jump arrival
    "Epilogue" if endings_seen >= 3:
      jump epilogue
```

- Your choices come first; the built-in Load, Settings and Quit follow (`title_buttons` still decides which). The built-in Start isn't added, since your menu starts the game.
- Choosing an option starts a new game from there. Variables start fresh, except `global var`s, which is how unlockable options work (`set endings_seen += 1` in each ending).
- If the label has no menu, the built-in buttons appear over whatever it drew.
- Coming back to the title (after an ending, or from the menu) plays the label again.
- `title` is never where a new game starts by itself; set `start:` in the header or have a label named `start` or a first label after `title`.

## 3. Your own screens (`screen title:`)
When the header and a scripted title aren't enough, draw the screen yourself: your art, your buttons, exactly where your designer put them.

```
---
title: The Keeper of Gullwing Point
canvas: 1920x1080
---

screen title:
  image "ui/title_bg.png"
  image "ui/logo.png" at 50% 30% anchor center alt "The Keeper of Gullwing Point"
  column at 1500px 640px anchor center gap 2%:
    button "New Game" image "ui/new.png" hover "ui/new_on.png" -> start
    button "Continue" -> continue
    button "Epilogue" -> start epilogue if endings_seen >= 3
    button "Settings" -> open settings
    button "Quit" -> quit
```

Each line is one element: `kind ["text"] [options] [-> actions] [if condition]`.

| Element | What it is |
|---|---|
| `image "ui/bg.png"` (or a declared image's name) | A picture. With no `at` or `size` it covers the whole screen (a background); placed with `at`, it keeps the size it was drawn at on your canvas. `alt "..."` describes it for screen readers. |
| `text "Version 1.0"` | Text, with the same `*styling*` and `{variables}` as dialogue. |
| `button "New Game" -> start` | A button. With `image "..."` (and `hover "..."` for when it's pointed at or focused) it's a picture; the label is still required: it's what screen readers say, and what translators translate. |
| `row:` / `column:` | Lines elements up across or down, `gap 2%` apart. The lines indented under it are its elements. |
| `box:` | A group with its own place and size (a panel), its elements stacked inside. |

**Placing things.** `at X Y` puts the element's top-left corner (or the point `anchor` names: `center`, `top`, `bottom-right`, ...) at a place across then down. Use percentages of the screen (`at 50% 30%`), or pixels when your art was drawn at a fixed size: put `canvas: 1920x1080` in the header and write `at 1500px 640px`. Pixels are measured on that canvas and scale with the window, so a screen drawn pixel-perfect in an image editor stays right on any screen. `size W H` sets a size (`auto` for either). Elements without `at` flow in the middle of the screen (or of their box), one under another.

**Actions** (after `->`, separated by commas):

| Action | What it does |
|---|---|
| `start` / `start epilogue` | A new game, from the beginning or from a label. |
| `continue` | Loads the most recent save (the button is greyed out when there are none). |
| `open settings` | Opens a screen: one of yours, or the built-in `load`, `save`, `settings`, `extras` and `history`. |
| `close` | Goes back to the screen underneath (Esc does the same). |
| `title` | Back to the title screen (asks first during a game). |
| `quit` | Quits (only in desktop and phone apps; greyed out in a browser). |
| `jump label` | Continues the story at a label, keeping the variables. |
| `set visits += 1` | Changes a variable; the screen redraws. A `global var` changed this way is remembered. |

`if condition` at the end of a line shows the element only while the condition holds, which is how unlockable extras work.

**Which screens you can replace.** `screen title` replaces the title menu (the header's `title_music` still plays, and a `label title` still plays behind it). `screen menu` is what the quick menu's **Menu** button opens during the story; without it, Menu goes back to the title. Any other name is a screen of your own, opened with `open name`. Load, save, settings and extras can't be replaced yet.

Screen text goes into translation files like every other line, and pictures can have a version per language (`ui/new.zh-Hant.png`).

## 4. Your own styles (`theme.css`)
Put a `theme.css` next to `story.vn`. It loads after the player's own styles, so anything in it wins. The editor's game pane uses it too, and restyles as you save it. Paths inside it are relative to the file, so fonts and images from your game folder work:

```css
@font-face { font-family: 'Lantern Serif'; src: url(assets/fonts/lantern.woff2); }

.stage { --story-font: 'Lantern Serif', serif; --accent: #e8b04b; }
.textbox { border-radius: 0; background: rgb(20 10 30 / 0.9); }
.title-screen .title { color: #f3e3b5; letter-spacing: 0.08em; }
```

Each character can have a text box of their own:

```css
.textbox[data-speaker="radio"] { font-family: 'Courier New', monospace; background: rgb(10 30 15 / 0.92); }
.textbox[data-speaker="mira"] { border-color: #e8b04b; }
```

These class names are kept stable between versions:

| Class | What it is |
|---|---|
| `.stage` | The whole game screen. Set variables here: `--accent`, `--story-font`, `--ui-font`, `--ui-text`, `--ui-muted`, `--ui-border`, `--choice-bg`, `--choice-hover`, `--pos-left`, `--pos-center`, `--pos-right`. |
| `.bg`, `.sprite` | Backgrounds and characters (`.sprite[data-tag="mira"]` for one character). A `.sprite` is a box holding one `img` per layer (just one for a plain image). |
| `.textbox`, `.textbox.narration`, `.namebox`, `.text`, `.next-indicator` | The text box. `.textbox[data-speaker="mira"]` while Mira speaks (the character id from `define`). |
| `.side-image`, `.textbox.has-side` | The speaker's portrait ([side images](script-syntax.md#side-images)) and the box while it shows one. `--side-w` on `.textbox` sets the portrait's width. |
| `.choices`, `.choice` | In-story choices. |
| `.quickmenu` | Back / Log / Auto / Skip / Save / Load / Settings / Menu. |
| `.overlay.title-screen`, `.title`, `.title-logo`, `.byline`, `.title-menu`, `.title-choice`, `.made-with` | The title screen (`.title-left`, `.title-right`, `.title-bottom` for the layouts). |
| `.overlay.panel`, `.settings`, `.slots`, `.log` | Settings, save/load and history screens. |
| `.end-screen`, `.ending-name` | "The End" and the ending reached. |
| `.extras-panel`, `.extras-tabs`, `.gallery`, `.gallery-item`, `.gallery-item.locked`, `.extras-list`, `.gallery-view` | The Extras screen. |
| `.nvl-page`, `.nvl-line`, `.nvl-name`, `.nvl-text` | NVL mode pages (`.nvl-line[data-speaker="mira"]` for one character's lines). |
| `.toast` | Short notices (achievements, "Saved"). |
| `.overlay.screen`, `.screen-root`, `.screen-<name>` | One of your own screens (`.screen-title`, `.screen-menu`). |
| `.screen-text`, `.screen-image`, `.screen-button`, `.screen-button.picture`, `.screen-row`, `.screen-column`, `.screen-box` | Their elements; add your own class with `class=name`. |

Players' accessibility settings (text size, fonts, box opacity, reduced motion) still apply on top of your theme; please don't fight them with `!important`.
