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

## 3. Your own styles (`theme.css`)
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

Players' accessibility settings (text size, fonts, box opacity, reduced motion) still apply on top of your theme; please don't fight them with `!important`.
