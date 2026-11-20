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
- `canvas`: the size your UI art is drawn at, like `1920x1080`, so [screens](theming.md#3-your-own-screens-screen-title) can place things in pixels. A game with a canvas is always shown at its shape, letterboxed, even on a phone held upright (without one, a tall screen gets the portrait layout).
- `save_slots`: how many save slots the game has (3 by default).
- `click_sound`, `hover_sound`: sounds for clicking and pointing at the buttons of your screens.

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
| `audio theme = "music/theme.ogg" music "Forget Me Not"` | A track in the **Extras** music room, with its title, once a player has heard it (played as music, in any playthrough). |
| `replay kitchen_talk "A Talk in the Kitchen" image kitchen` | A scene players can replay from **Extras** once they've reached it: the story from that label, with fresh variables and no saving, until it leaves the label (calls into other labels are part of it), or until `until other_label` when the scene spans several labels. `image` is its picture in the list. |
| `ending light_holds "The Light Holds"` | An ending, reached with `end light_holds`. Extras lists every ending, with the ones not reached yet as ???. |
| `achievement first_light "First Light"` | An achievement players can earn. Use the same id as on Steam. |
| `label name:` | A scene of your story. Everything indented under it runs in order. |

Comments start with `#`: a whole line, or the end of any line after a space.

```
# The opening scene
label start:  # rewrite after playtesting
  scene kitchen with fade  # morning light
  mira: Room #4, please.  # "#4" is text: no space after the #
```

A `#` starts a comment when it has a space before it and a space (or the end of the line) after it, outside quotes. So `Room #4`, `color=#e8b04b` and `"Track # 2"` are not comments; in unquoted dialogue, write `\#` for a lone `#` with spaces around it. Tools that rewrite your script (`emaki fmt`, the visual editor) keep your comments and blank lines.

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
| `play ambience wind as wind` | A named ambience loop: several named ones play at once (rain, wind and a crowd together), and `stop ambience wind` stops just that one. `stop ambience` stops them all. |
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

## Free layers
Some games compose every shot: a background built from several pieces, a close-up made by zooming one picture, light laid over the scene, a slow pan under the text. Any image can be a layer, placed at a point and turned, zoomed and faded.

```
---
canvas: 1920x1080
---
image street = "bg/street.png"
image glow = "fx/glow.png"

label night:
  show street as far at 960 540 zoom 0.65
  show glow at 25% 50% blend add opacity 0.8 depth 5
  with dissolve 0.5
  "The lamps came on one by one."
  animate far zoom 0.75 at 900 520 over 6 ease in-out-sine
  "Further down the street, something moved."
```

| Line | Meaning |
|---|---|
| `show street as far at 960 540` | Show an image as a layer called `far`, its middle at that point. A plain number is a pixel on the game's `canvas` (1920 x 1080 if the header doesn't say); `50%` is a percentage of the screen. Without `as`, the layer is called by the image's first word. |
| `anchor 50% 100%` | Which point of the image goes at that point: across, then down, as percentages of the image (the middle by default). The image turns and zooms about it too. |
| `zoom 0.65` / `zoom 1.2 0.8` | Size: 1 is the image's own size on the canvas. Two numbers zoom across and down separately; a negative one mirrors the image (`zoom -1 1` flips it left to right). |
| `rotate -17.3` | Turn by degrees, clockwise. |
| `opacity 0.8` | 0 is invisible, 1 solid. |
| `depth 5` | Layers with a higher depth are in front (characters are at 0). Equal depths stack in the order they were shown. |
| `blend add` | How the layer mixes with what's under it: `normal`, `add`, `subtract`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `dodge`, `burn`, `hard-light`, `soft-light`, `difference`, `exclusion`. |
| `show street night as far` | Put another image on the same layer: it keeps its place and properties. |
| `animate far zoom 0.75 at 900 520 over 6 ease in-out-sine` | Move a layer toward new values (`at`, `anchor`, `zoom`, `rotate`, `opacity`) over seconds, without holding up the story. Eases: `linear`, or `in-`, `out-`, `in-out-` or `out-in-` with `quad`, `cubic`, `quart`, `quint`, `sine`, `circ`, `expo`, `elastic`, `back` or `bounce`. |
| `with dissolve 0.5` | On its own line: every picture change since the last line appears together, through one transition (`dissolve`, `fade`). |
| `with wipe rule_13 0.8` | The same, wiping through a grey-scale *rule* picture (an image's name, or a path in quotes): the new picture comes in where the rule is dark first, with a soft edge. |
| `textbox hide over 0.5` | Takes the text box (or NVL page) off the picture, so a shot can be seen whole; it comes back with the next line, or with `textbox show`. |

For moves with several steps, or that repeat, declare an animation at the top and play it on a layer:

```
animation flicker loop:
  0 opacity 0.6
  0.4 opacity 1 ease out-sine
  1.2 opacity 0.6

label night:
  animate light with flicker
  "The lamp sputtered."
  animate light stop
```

- Each key starts with its time in seconds, then the properties it sets (`at`, `anchor`, `zoom`, `rotate`, `opacity`); what a key leaves out holds. Its `ease` is how it moves toward the next key.
- `loop` starts over from the first key, until `animate light stop`, `hide` or a new `scene`. An animation without `loop` leaves the layer at its last key.
- Characters work as before (`show mira smile at left`), and can take `zoom`, `rotate`, `opacity`, `depth` and `blend` too.
- A save, a load or going back shows layers where their moves were going. Skipping and **Animations: reduced** put them there at once.
- `clip 0 135 1920 810` shows only that rectangle of the screen (x, y, width, height); `feather 32` fades the picture out over that far inside its edges. A clip stays where it is on the screen while the layer moves.

### Colour on layers
```
grade dusk: gamma 0.94 0.78 0.57 levels #000010 #546b90 tint #ff6500 14% overlay
grade memory: gray tint #a06030 30%

label night:
  show street as far grade dusk
  show mira silhouette #000000
  show glow bright 1.2 contrast 0.8 blur 6
```

| Property | Meaning |
|---|---|
| `grade dusk` | Colours the layer with a grade declared at the top. `grade none` takes it off. |
| `silhouette #000000` | Only the layer's shape, in one colour. `silhouette none` takes it off. |
| `bright 1.2` | Brightness: 1 is unchanged, each 0.1 adds a tenth of white, lower darkens (0 to 2). |
| `contrast 0.8` | Contrast: 1 is unchanged, lower is flatter, higher harsher (0 to 3). |
| `blur 6` | Blurs the layer by that radius (canvas pixels, or a percentage of the screen's width); `blur 0` sharpens it again. |

A grade is a line of steps, done in this order whatever order they're written in:
- `gray`: the picture in grey first.
- `gamma 0.9 0.8 0.6`: bends each channel (red, green, blue; one number for all three). Below 1 darkens the middle tones, above 1 lightens them.
- `levels #000010 #546b90`: where black and white go. `levels #ffffff #000000` is a negative.
- `tint #ff6500 14% overlay`: lays a colour over the picture, that strongly. Modes: `normal` (the default), `add`, `plus`, `multiply`, `screen`, `overlay`, `dodge`. Several tints apply one after another.

These are set with `show`; `animate` can't move them. The whole picture's `tone` (`tone sepia`) still works as before.

## Character moves
Small moves bring a still sprite to life: a startled hop, a nod, a bow.

```
label greeting:
  show mira at left
  mira: Oh! You scared me.
  hop mira
  nod mira 2
  mira: Yes, yes, I'm fine.
  bow mira
  shake textbox
```

| Line | Meaning |
|---|---|
| `hop mira` | A quick hop up and down (surprise, excitement). |
| `nod mira` | A nod. `nod mira 2` nods twice. |
| `bow mira` | A slow bow. |
| `shake mira` | Shakes her head (side to side). Plain `shake` still shakes the whole picture. |
| `shake textbox` | Moves the text box instead of a character; works with every move. |
| `float icon` | Drifts gently up and down, without end: a dream, a ghost, a floating icon. |
| `shake mira forever` | Any move with `forever` repeats until stopped: a trembling cut-in, a hopping mascot. |
| `still mira` | Stops her endless move. |

- A number after the name repeats the move (1 to 10 times).
- An endless move belongs to the character: it carries on through the lines that follow, saves and going back keep it, and it ends with `still`, `hide` or a new `scene`. The text box can't move endlessly.
- Moves don't hold up the story: the line after one appears while it plays.
- A move on a character who isn't on screen does nothing. Skipping, going back and **Animations: reduced** leave moves out.
- `hop`, `nod`, `bow`, `float`, `still` and `tone` aren't reserved words either: `bow: Hello.` is a character called bow speaking.

## Colour tones
```
label flashback:
  tone sepia over 1.5
  scene old_school with dissolve
  "Ten years earlier."
  scene old_station
  tone none over 1.5
```

`tone sepia` (old photographs, the past) and `tone mono` (black and white) tint the picture, characters included, but never the text. `tone none` brings normal colours back; `over` fades between tones. A tone lasts across scene changes until you change it, so a whole flashback needs just two lines. Saves and going back keep it.

## Movies
```
label opening:
  stop music fade 1
  movie "movie/opening.mp4"
  scene title_card with fade
```

`movie` plays a video over the whole screen; the story goes on when it ends. Players skip it with a click, Enter, Space or Escape, and skipping mode leaves it out. It plays at the music volume. MP4 (H.264 video, AAC sound) works in every browser and on phones; WebM works everywhere except older iPhones. A movie can have a version per language, like pictures (see [Translations](#translations)): `movie/opening.ja.mp4`.

## Plugins
```
  @weather start kind="petals" amount=60
  @memory play pairs=4 -> turns
```
A line starting with `@` runs a command from one of the game's [plugins](plugins.md) (in `plugins/<name>/`), with named arguments (`name=value`: a number, a quoted string, `true`/`false`, a variable, or an expression without spaces). `-> variable` keeps the result of a command the story waits on, like a minigame's score. In expressions, `@plugin.function(...)` asks one of a plugin's functions (`if @dice.roll(6) > 4:`). The compiler checks each line and call against the plugin's `plugin.json`.

## Screens during the story
```
  show screen hud
  call screen map -> place
  hide screen hud
```
`show screen` keeps one of your own [screens](theming.md#screens-during-the-story) (a status bar, a phone) over the story until `hide screen`. `call screen map -> place` shows one and waits until one of its buttons returns (`-> return "beach"`), putting what it returns in the variable `place`; leave out `-> place` when only the waiting matters.

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
| `[ruby=うすくれない]薄紅[/ruby]` | 薄紅 with its reading (furigana) in small type above it |
| `Room 5 \* 3` | Room 5 * 3 |

A backslash shows `*`, `[`, `]`, `#` or `\` literally. Ordinary square brackets are just text; only `[color=...]`, `[ruby=...]`, their closing tags and the pauses below are special. Inside italic narration, `*emphasis*` turns upright so it still stands out. An unclosed `*` or `[color]` is reported with its line number.

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

Pictures with text drawn in them (a sign, a letter, sound-effect lettering) can have a version per language: put it next to the original with the language code before the extension. With `image letter = "cg/letter.png"`, the file `cg/letter.fr.png` is shown to French players and `cg/letter.zh-Hant.png` to players reading Traditional Chinese. This works for backgrounds, characters (and each layer), side images, the gallery and movies (`movie/opening.ja.mp4`); files without a version are shared by every language.

A device set to Chinese gets the right script: `zh-TW` and `zh-HK` choose a `zh-Hant` translation, `zh-CN` a `zh-Hans` one.

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
Plural forms in translations, explicit line ids.
