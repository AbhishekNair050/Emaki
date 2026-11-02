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
- `voice`: where each line's voice file is, for a fully voiced game: `voice/{id}.ogg` (see [Voiced games](#voiced-games)).
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
| `layered mira:` | A character drawn from stacked layers (body, outfit, face), so outfits and expressions combine freely. See [Layered characters](#layered-characters). |
| `audio rain = "audio/rain.ogg"` | A named sound. |
| `var trust = 0` | A variable with its starting value. Numbers, `"text"`, `true`/`false`. Must be declared before use. |
| `global var endings_seen = 0` | A variable that keeps its value across playthroughs on this device (endings seen, unlocked extras). Loading a save or going back never undoes it. |
| `image side mira smile = "side/mira_smile.png"` | A **side image**: Mira's portrait in the text box while she's smiling. See [Side images](#side-images). |
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
| `show mira at right with move` | Slide a character who's already on screen to a new position (`with move 1.2` for a slower slide). |
| `hide mira with dissolve` | Remove a character. |
| `play music "audio/theme.ogg"` / `play sound rain` | Audio. Music loops by default, with no gap at the loop point. Options: `loop`, `noloop`, `fade 1.5`. |
| `play ambience rain fade 2` | A background loop that plays under the music (rain, wind, a crowd), separate from sound effects, so `stop sound` leaves it alone. Loops by default; follows the sound effects volume. |
| `play voice "voice/ann_001.ogg"` | A voice line, put just before the line it belongs to. It stops when the player moves on, and auto mode waits for it to finish. A fully voiced game doesn't need these: see [Voiced games](#voiced-games). |
| `stop music fade 2` | Stop a channel (`music`, `ambience`, `sound`, `voice`). `stop sound` stops a looping sound and any effects still playing. |
| `set trust += 1` | Change a variable. Also `=` and `-=`. |
| `jump label_name` | Go to another label (no coming back). |
| `call label_name` / `return` | Visit a label and come back when it ends. |
| `wait 1.5` | Pause for 1.5 seconds. |
| `achieve first_light` | Award an achievement (once; earning it again does nothing). On Steam it unlocks the Steam achievement; elsewhere the game remembers it and shows a notice. |
| `end` | The story ends here. `end light_holds` reaches a declared ending: its name shows on the end screen and it's recorded for Extras. |

Transitions: `fade` (through black), `dissolve` (crossfade), `move` (slide to the new position), `none`. Add seconds to set the length: `scene beach with dissolve 1.5`, `scene night with fade 3` (the whole fade, out and back in). Without a number, a dissolve takes 0.4 s and a fade 0.9 s.

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

## Layered characters
Drawing every outfit with every expression adds up fast: 3 outfits × 12 faces is 36 images. A layered character is drawn from parts instead, stacked bottom first:

```
layered mira:
  always "sprites/mira/body.png"
  group outfit:
    casual "sprites/mira/casual.png"
    coat "sprites/mira/coat.png"
  group face:
    neutral "sprites/mira/neutral.png"
    smile "sprites/mira/smile.png"
    sad "sprites/mira/sad.png"
  group blush optional:
    blush "sprites/mira/blush.png"
```

- `always` is a layer that's always drawn. Each `group` shows one of its options at a time; the first is the default.
- An `optional` group shows nothing until you pick one of its options.
- Options are picked like attributes of a plain image, and each one replaces only its own group: `show mira coat` changes the outfit and keeps the face; `mira smile: Hi!` changes the face and keeps the coat. `show mira sad casual` changes both.
- `-option` takes an optional group's layer off: `show mira -blush`, or `mira -blush: Anyway.`
- Draw every layer on the same canvas size, lined up, with transparent backgrounds; the player lays them exactly on top of each other.
- A tag is either layered or plain images: `layered mira` and `image mira smile = ...` together is an error. Option names must be unique within a character, since a name picks its group.

## Side images
A portrait of the speaker in the corner of the text box, common in stories told from one character's point of view, whose sprite is never on screen:

```
image side mira = "side/mira.png"
image side mira smile = "side/mira_smile.png"
image side mira sad = "side/mira_sad.png"

label start:
  mira: Her plain portrait.
  mira smile: Now she's smiling.
  mira: Still smiling: the portrait remembers her last expression.
```

- The portrait follows the speaker's attributes from dialogue (`mira smile:`) and from `show`, on screen or off. The most specific match wins: with `side mira smile coat` and `side mira smile` both declared, Mira smiling in her coat gets the first.
- `side mira` alone is the fallback. A character without side images has none, and narration never does.
- `mira smile:` is fine even when only a side image is called `smile`: if Mira is on screen, her sprite stays as it is.
- Style the portrait with `.side-image` in [`theme.css`](theming.md).

## Camera and screen effects
```
label storm:
  scene cliff_road with fade
  camera zoom 1.6 at 80% 30% over 6
  "Far off, a light came on in the tower."
  flash
  scene cliff_lightning
  shake 0.8
  mira: That was close!
  camera reset over 2
```

| Line | Meaning |
|---|---|
| `camera zoom 1.6 at 80% 30% over 6` | Zoom in on the picture (backgrounds and characters; the text box stays put). `1` is the whole picture, `2` twice as close. `at` is the point to zoom toward, across then down, as percentages of the screen (the centre if left out). `over` is how long the move takes (instant if left out). |
| `camera reset over 2` | Back to the whole picture. |
| `shake` / `shake 0.8` | Shake the picture for half a second (or the seconds given). |
| `flash` / `flash red 0.4` | Flash the screen: `white` (the default), `black`, `red` or `#rrggbb`, for 0.6 s or the seconds given. |

- Camera moves don't hold up the story: a slow pan plays while the next lines appear. Put a `wait` after one to watch it finish first.
- Panning is zooming toward a different point at the same zoom: `camera zoom 1.6 at 20% 50% over 5` after the line above sweeps across to the left.
- The camera stays where it is until `camera reset` or a new `scene`, and saves and going back keep it.
- A `flash` covers the screen before the next line runs, so `flash` followed by `scene` changes the picture under the white.
- With the player's **Animations: reduced** setting, the camera jumps straight to its place and shakes and flashes are left out.
- `shake`, `flash` and `camera` aren't reserved words: a character can still be called `flash` (`flash: Hi!` is dialogue).

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

A backslash shows `*`, `[`, `]` or `\` literally. Ordinary square brackets are just text; only `[color=...]`, `[/color]` and the pauses below are special. Inside italic narration, `*emphasis*` turns upright so it still stands out. An unclosed `*` or `[color]` is reported with its line number.

## Pauses inside a line
Dialogue and narration can stop partway, the way people pause when they talk.

| You write | What happens |
|---|---|
| `mira: I thought...[w] never mind.` | The text stops after "I thought..." until the player clicks, then goes on in the same box. |
| `"The door creaked.[w=1.5] Then nothing."` | A 1.5-second pause, no click needed (up to 30 seconds). |
| `mira: If you'd just listen[nw]` | `[nw]` at the very end: the next line follows by itself, without a click. Good for interruptions. |
| `"Silence.[w=2][nw]"` | Stays on screen for two seconds, then moves on by itself. |

- A click while the text is typing shows everything up to the next `[w]` at once.
- Auto mode treats a `[w]` like the end of a line: it waits its usual delay and goes on. Skipping ignores pauses.
- The history log and screen readers get the line without the pause marks.
- Pauses don't work in choices.

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

## Voiced games
Writing `play voice` before every line of a fully voiced game is a lot of typing. Instead, tell Emaki where the files are, in the header:

```
---
title: The Keeper of Gullwing Point
voice: voice/{speaker}/{id}.ogg
---
```

`{id}` is each line's id and `{speaker}` the character who says it (`narrator` for narration). A line plays its file if there is one; lines without a file are silent.

```sh
npm run emaki -- voices games/mygame/story.vn
```

writes `voice-script.csv` next to the story: every line with the file name it needs, who says it, the text, and whether it's recorded yet. Hand it to your voice actors, or sort it by speaker for each recording session. Run it again whenever you like: it reports how many lines are recorded and lists files that no line uses any more.

- A line's id comes from its speaker and text, so editing a line gives it a new id, and its old recording shows up in that list. Rename the file to the new name, or record the line again.
- A `play voice` just before a line still wins, for the odd line that needs a different take.
- In the history log, ▶ next to a line plays its voice again.

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
Plural forms in translations, explicit line ids, inline (end-of-line) comments, plugins.
