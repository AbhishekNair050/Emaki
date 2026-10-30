# Writing a story in Emaki (`.vn` syntax, v0 draft)

An Emaki story is a plain text file. It reads like a screenplay. Indent with spaces (two is typical).

```
---
title: The Keeper of Gullwing Point
author: You
start: arrival
---

define mira "Mira" color=#e8b04b

image cliff_road = "bg/cliff_road_dusk.svg"
image mira neutral = "sprites/mira_neutral.svg"
image mira smile = "sprites/mira_smile.svg"

var trust = 0

label arrival:
  scene cliff_road with fade
  show mira neutral at center with dissolve
  "The bus left me where the road gave up."
  mira: You're early. Nobody's ever early.

  menu:
    "I wanted to see the light come on.":
      set trust += 1
      mira smile: Did you now.
    "The driver wanted to beat the storm.":
      mira: Smart man.

  if trust >= 1:
    jump good_start
  else:
    jump cold_start
```

## Header (optional)
Between `---` lines at the very top: `key: value` pairs.
- `title`, `author`: shown on the title screen.
- `start`: the label the story begins at (default: `start`, else the first label).
- `title_image`, `title_music`, `title_logo`, `title_layout`, `title_buttons`: the title screen's look. A label named `title` replaces the title screen with a scene of your own. See [Theming](theming.md).
- `nvl`: `on` to start the story in full-screen text (see [NVL mode](#full-screen-text-nvl-mode)).
- `narration`: `italic` (the default) or `plain`. Plain suits stories told mostly in narration, such as first-person novels.
- `aspect`: the shape of the screen, as width:height (default `16:9`). Use `4:3` for art drawn for older screens; the game is letterboxed to fit.
- `language`: the language the script is written in, as a code (`en`, `fr`, `pt-BR`; default `en`).
- `app_id`: a reverse-domain id for app stores and phones (`com.yourstudio.gullwing`); `emaki export` makes one up if it's missing.
- `steam_app_id`: your game's Steam App ID; the desktop build then talks to Steam (achievements, overlay).

## Declarations (top level, no indentation)
| Line | Meaning |
|---|---|
| `define mira "Mira" color=#e8b04b` | A character. `mira` is what you type; `"Mira"` is what players see. |
| `image kitchen = "bg/kitchen.png"` | A background or any image. Paths are relative to the game's `assets/` folder. |
| `image mira smile = "sprites/mira_smile.png"` | A character image: first word is the **tag** (`mira`), the rest are **attributes** (`smile`). |
| `audio rain = "audio/rain.ogg"` | A named sound. |
| `var trust = 0` | A variable with its starting value. Numbers, `"text"`, `true`/`false`. Must be declared before use. |
| `global var endings_seen = 0` | A variable that keeps its value across playthroughs on this device (endings seen, unlocked extras). Loading a save or going back never undoes it. |
| `image beach_kiss = "cg/beach.png" gallery` | An image that appears in the **Extras** gallery once a player has seen it (in any playthrough). |
| `ending light_holds "The Light Holds"` | An ending, reached with `end light_holds`. Extras lists every ending, with the ones not reached yet as ???. |
| `achievement first_light "First Light"` | An achievement players can earn. Use the same id as on Steam. |
| `label name:` | A scene of your story. Everything indented under it runs in order. |

Full-line comments start with `#`. Tools that rewrite your script (`emaki fmt`, the visual editor) keep your comments and blank lines.

## Story lines (indented under a label)
| Line | Meaning |
|---|---|
| `"Some narration."` | Narration (no speaker). |
| `mira: Some dialogue.` | Mira speaks. Quotes are optional: `mira: "Hi."` works too. |
| `mira smile: Glad you came.` | Mira speaks **and** switches to her `smile` image (if she's on screen). |
| `scene kitchen with fade` | New background; clears characters. `scene black` for a black screen. |
| `show mira smile at left with dissolve` | Show (or change) a character. Positions: `left`, `center`, `right`, or a percentage of the screen's width for the character's centre (`at 30%`). |
| `hide mira with dissolve` | Remove a character. |
| `play music "audio/theme.ogg"` / `play sound rain` | Audio. Music loops by default. Options: `loop`, `noloop`, `fade 1.5`. |
| `play voice "voice/ann_001.ogg"` | A voice line, put just before the line it belongs to. It stops when the player moves on, and auto mode waits for it to finish. |
| `stop music fade 2` | Stop a channel (`music`, `sound`, `voice`). `stop sound` stops a looping sound and any effects still playing. |
| `set trust += 1` | Change a variable. Also `=` and `-=`. |
| `jump label_name` | Go to another label (no coming back). |
| `call label_name` / `return` | Visit a label and come back when it ends. |
| `wait 1.5` | Pause for 1.5 seconds. |
| `achieve first_light` | Award an achievement (once; earning it again does nothing). On Steam it unlocks the Steam achievement; elsewhere the game remembers it and shows a notice. |
| `end` | The story ends here. `end light_holds` reaches a declared ending: its name shows on the end screen and it's recorded for Extras. |

Transitions: `fade` (through black), `dissolve` (crossfade), `none`. Add seconds to set the length: `scene beach with dissolve 1.5`, `scene night with fade 3` (the whole fade, out and back in). Without a number, a dissolve takes 0.4 s and a fade 0.9 s.

Reaching the end of a label **returns** to whoever `call`ed it; if nobody did, the story ends. Labels never "fall through" into the next one.

## Full-screen text (NVL mode)
Narration-heavy stories often show text as pages of paragraphs over the whole screen instead of one line in a box.

```
label night_walk:
  scene street_night with fade
  nvl on
  "The street was empty."
  "Somewhere a dog barked, twice, and gave up."
  mira: You came.
  nvl clear
  "Later, I would wonder why I did."
  nvl off
  mira: Well? Say something.
```

- `nvl on` switches to pages; `nvl off` goes back to the text box. `nvl: on` in the header starts the whole story in NVL mode.
- A page fills up line by line and turns over by itself when it's full. `nvl clear` starts a new page sooner, and so does a new `scene`.
- Dialogue shows the speaker's name before the line. Menus appear over the page.

## Choices
```
menu:
  "Read the letter.":
    set read_letter = true
    "I shouldn't. I do anyway."
  "Ask her about it." if trust >= 2:
    jump ask
```
A choice with `if ...` only appears when the condition is true.

## Conditions
```
if boat_safe and trust >= 2:
  jump best_ending
elif boat_safe:
  jump good_ending
else:
  jump rough_ending
```
Operators: `+ - * / %`, `== != < <= > >=`, `and or not`, parentheses. Text can be joined with `+`.

## Styling text
Works in dialogue, narration and choices.

| You write | Players see |
|---|---|
| `I *never* said that.` | I *never* said that. |
| `This is **important**.` | This is **important**. |
| `***Run!***` | bold and italic |
| `The [color=#e8b04b]lamp[/color] dies.` | "lamp" in gold (a hex code, or a colour name like `gold`) |
| `Room 5 \* 3` | Room 5 * 3 |

A backslash shows `*`, `[`, `]` or `\` literally. Ordinary square brackets are just text; only `[color=...]` and `[/color]` are special. Inside italic narration, `*emphasis*` turns upright so it still stands out. An unclosed `*` or `[color]` is reported with its line number.

## Variables in text
`mira: You've earned {trust} points of my trust.` Use `{{` and `}}` for literal braces.

## Translations
Every line has an id, so translations live in their own files and follow the lines when you move scenes around.

```sh
npm run emaki -- strings games/mygame/story.vn --lang fr,de      # create or update lang/fr.po and lang/de.po
npm run emaki -- strings games/mygame/story.vn --lang ja --csv   # a spreadsheet instead (lang/ja.csv)
npm run emaki -- strings games/mygame/story.vn                   # progress of every translation
```

`.po` files open in translation tools (Poedit, Weblate, Crowdin); `.csv` files open in any spreadsheet. Each holds every line, choice, character name, achievement and the game's own buttons, with a note on who speaks. Translations may use the same `*styling*` and `{variables}` as the original. Run the command again after editing the story: new lines are added, translations are kept, and a line you changed gets its old translation back marked **for review** (fuzzy in PO, `review` in CSV) until a translator checks it. The game uses only reviewed translations and shows the original for anything missing.

Players pick a language in Settings; by default the game matches their device.

## Splitting a story across files
A long story can live in several files. `story.vn` is the main one (only it has the header); every other `.vn` file in the game folder, in subfolders too, is part of the same story:

```
mygame/
  story.vn            header, characters, the opening
  chapters/one.vn
  chapters/two.vn
  routes/mira.vn
```

Everything is shared: a label in one file can `jump` to a label in another, and characters, images, variables and achievements can be declared in any file (each name once in the whole story). The order of files doesn't matter. Errors name the file they're in (`chapters/two.vn:14`). The folders `assets`, `lang`, `dist`, `export` and `tools` are never searched for scripts. In the editor, pick a file above the script or add one with **+ New file**.

## Errors
`npm run check` (or the dev player) lists every problem with its line number and a suggested fix, e.g.
`story.vn:52: Unknown name 'kitchen_tlak'. Did you mean 'kitchen_talk'?`

## Not yet supported (planned)
Animations, layered sprites, voice-line auto-mapping, plural forms in translations, explicit line ids, inline (end-of-line) comments, plugins.
