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
| `button "New Game" -> start` | A button. With `image "..."` it's a picture; the label is still required: it's what screen readers say, and what translators translate. Pictures for its other states are optional: `hover` (pointed at or focused), `pressed`, `selected` (its action is in effect: auto is on, the setting it sets holds, it's the page or tab shown) and `disabled` (it can't be used now; without one it's dimmed). |
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
| `return` / `return "beach"` | On a screen the story called (`call screen map -> place`), goes on with the story, putting the value in the call's variable. Elsewhere it's the same as `close`. |
| `switch load` | Shows another screen in this one's place, for tabs (Save and Load, pages of settings): `close` then goes back to what was under both. |
| `setting skip_unread on`, `setting language ja` | Sets a player setting, for settings drawn as picture buttons (one per option). The button shows as selected while the setting holds that value. Toggles take `on`/`off`, sliders a number, choices one of their options. |
| `back`, `auto`, `skip`, `hide` | The story's own controls, for a text box or menu of yours: go back a line, auto-play, skip, hide the interface until the next click. `auto` and `skip` buttons show as selected while on. |
| `quicksave`, `quickload` | Save to, and load from, one quick slot (Quick load is greyed out until there's a quick save). |
| `voice` | Plays the line's voice again. |

`if condition` at the end of a line shows the element only while the condition holds, which is how unlockable extras work.

**Which screens you can replace.** `screen title` replaces the title menu (the header's `title_music` still plays, and a `label title` still plays behind it). `screen menu` is what the quick menu's **Menu** button opens during the story; without it, Menu goes back to the title. `screen save`, `screen load`, `screen settings` and `screen extras` replace those built-in screens everywhere they open (the quick menu, the title, `open load`). Any other name is a screen of your own, opened with `open name`.

**Screens that fade in.** `screen settings with fade 0.3:` fades the screen in when it opens (0.3 seconds by default); redrawing it, or turning its pages, doesn't. Players who ask for less motion get no fade.

**Interface sounds.** `click_sound: sound/ui/click.ogg` and `hover_sound: sound/ui/hover.ogg` in the header play on every button of your screens, at the sound effects volume.

**Gamepads.** Every screen works with a gamepad, with no setup: the d-pad or left stick moves to the nearest button in that direction (so any layout works), A presses it, or goes on with the story when nothing is chosen; B closes the screen on top, Start opens the menu, LB goes back a line and RB goes on. Left and right move sliders.

**Editing them.** In the editor, put the cursor inside a `screen` and the game shows that screen, redrawn as you type.

### The text box
```
screen textbox:
  image "ui/window.png" at 0px 829px
  image "ui/nameplate.png" at 57px 786px if speaker
  speaker at 215px 756px
  dialogue at 220px 855px size 1522px 210px
  side at 0px 600px
  button "Auto" image "ui/auto.png" hover "ui/auto_on.png" selected "ui/auto_lit.png" at 1172px 777px -> auto
  button "Save" image "ui/save.png" at 780px 776px -> open save
  button "Hide" image "ui/hide.png" at 1762px 776px -> hide
```

`screen textbox` replaces the text box. `dialogue` is where the line appears (it types out, pauses and waits as usual), `speaker` the speaker's name and `side` their side image; place them like any element. The screen also sees `speaker`, the name of who is talking (`""` for narration), so a name plate can show only when someone speaks. Buttons on it replace the quick menu; a text box without buttons keeps it. Style the words with `.textbox .text` and `.namebox`, and the ▾ "click to continue" mark with `.next-indicator`, in your theme.css. NVL pages are unchanged.

### Save and load screens
```
---
save_slots: 60
---

screen load:
  image "ui/load_bg.png"
  slots 6 columns 3 at 50% 52% anchor center gap 2% -> load:
    thumbnail
    text "{slot_number}. {slot_date}" if not slot_empty
    text "{slot_number}. Empty" if slot_empty
  row at 50% 90% anchor center:
    button "Previous" -> page previous
    text "{page} / {pages}"
    button "Next" -> page next
  button "Back" at 95% 95% anchor bottom-right -> close

screen save:
  slots 6 columns 3 -> save
  button "Back" -> close
```

- `slots 6 -> load` (or `-> save`) is a grid of six save slots; each is a button that loads or saves that slot. `columns 3` sets how many across.
- The lines indented under `slots` are what each slot shows; leave them out for a picture, the date and the line it was saved at. Inside, `{slot_number}`, `{slot_date}`, `{slot_text}` (the line it was saved at) and `slot_empty` describe that slot, and `thumbnail` is the saved scene, drawn small (background, characters and tone, restyled by your theme.css like the real stage). Slots can't hold buttons, since each slot is one.
- Slots can be pictures too: `slots 8 columns 2 image "ui/slot{slot_cell}.png" hover "ui/slot{slot_cell}_on.png" -> save`, where `{slot_cell}` is the slot's place on the page (1 to 8 here), for art that differs by place. Elements inside a picture slot are placed from the slot's top-left corner.
- `save_slots: 60` in the header sets how many save slots the game has (3 by default); the built-in save screen shows them all. `-> page next`, `-> page previous` and `-> page 2` turn the page, and `{page}` and `{pages}` show where you are. The page is remembered while the game is open.

### Settings screen
```
screen settings:
  image "ui/config_bg.png"
  column at 50% 50% anchor center gap 2%:
    slider "Music" music_volume
    slider "Text speed" text_speed
    toggle "Skip unread text" skip_unread
    choice "Language" language
  button "Done" -> close
```

| Control | Settings it can show |
|---|---|
| `slider "Label" name` | `text_speed`, `auto_wait`, `music_volume`, `sound_volume`, `voice_volume`, `text_size`, `box_opacity` |
| `toggle "Label" name` | `skip_unread`, `animations`, `fullscreen` (desktop apps) |
| `choice "Label" name` | `font`, `language`, `animations` (as the device says, full, reduced), `skip` (read text, all text) |

Changes apply at once and are remembered, exactly as in the built-in screen. The label is what the control is called on screen and for screen readers.

A slider can be a picture: `slider "Music" music_volume image "ui/gauge.png" knob "ui/knob.png" at 919px 214px size 400px 18px`. The `image` fills the slider from the left up to its value (draw the empty track in the screen's background), and the `knob` rides on it; without a knob the gauge alone shows the value. Its label is then only for screen readers. For on/off and multiple-choice settings drawn as pictures, use one button per option with `-> setting name value` and a `selected` picture.

### Screens during the story
Your own screens can also appear while the story plays: a status bar, a phone, a map to pick a place from.

```
var day = 1
var place = ""

screen hud:
  text "Day {day}" at 3% 4% anchor top-left
  button "Phone" image "ui/phone.png" at 97% 4% anchor top-right -> open phone

screen map:
  image "ui/map.png"
  button "Beach" image "ui/pin.png" at 30% 60% -> return "beach"
  button "Town" image "ui/pin.png" at 70% 40% -> return "town"
  button "Not yet" at 50% 92% anchor center -> return

label start:
  show screen hud
  "Morning."
  call screen map -> place
  if place == "beach":
    jump beach
  hide screen hud
```

- `show screen hud` keeps the screen over the story, line after line, until `hide screen hud` (or its own `close` button). Its `{variables}` stay up to date. Clicks on its buttons go to the buttons; clicks anywhere else go on with the story as usual. Several can be shown at once; each new one goes on top. They're part of the game's state, so saves, loading and going back keep them.
- `call screen map -> place` shows the screen and waits: the story goes on only when one of its buttons returns. `-> return "beach"` puts `"beach"` in `place`; a plain `-> return` (or `close`) goes on without changing it. `-> place` can be left out when the answer doesn't matter. The line said before stays in the text box underneath, like with choices, and going back returns to the screen.
- These screens are drawn under the quick menu and above the text box, so a full-screen map covers the text box but the player can still save, load or open the settings. They're hidden with the rest of the interface when the player hides it (the H key); a called screen isn't, since it's waiting for an answer.
- The screens the player opens themselves (`title`, `menu`, `save`, `load`, `settings`, `extras`) can't be shown or called. The compiler warns when a called screen has no button that returns, since the story would wait forever.
- Style them with `.screen-layer .screen-hud`, `.screen-root.shown` and `.screen-root.called`.

### Extras screen
`gallery 12 columns 4` is a page of gallery images (pictures seen so far, ??? for the rest; click one to see it full size, with the same `page` actions as slots). `endings` and `achievements` list the endings reached and achievements earned. Style them with `.screen-gallery-item`, `.screen-endings li.done` / `.locked` and so on.

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
| `.picture`, `.selected`, `.screen-slot.picture`, `.screen-slider.picture .fill` | Picture buttons, slots and sliders, and buttons whose action is in effect. |
| `.stage.own-textbox`, `.screen-part` | A game with `screen textbox`, and the line, name and side image it places. |
| `.screen-layer`, `.screen-root.shown`, `.screen-root.called` | Screens over the story (`show screen`, `call screen`) and the layer that holds them. |
| `.screen-text`, `.screen-image`, `.screen-button`, `.screen-button.picture`, `.screen-row`, `.screen-column`, `.screen-box` | Their elements; add your own class with `class=name`. |
| `.screen-slots`, `.screen-slot`, `.screen-slot.empty`, `.screen-slot-caption`, `.screen-slot-text`, `.thumb` | Save slots and their pictures. |
| `.screen-gallery`, `.screen-gallery-item`, `.screen-gallery-item.locked`, `.screen-endings`, `.screen-achievements` (`li.done`, `li.locked`) | Extras. |
| `.screen-slider`, `.screen-toggle`, `.screen-choice`, `.screen-label`, `.screen-field` | Setting controls (a label holding the name and the control). |

Players' accessibility settings (text size, fonts, box opacity, reduced motion) still apply on top of your theme; please don't fight them with `!important`.
