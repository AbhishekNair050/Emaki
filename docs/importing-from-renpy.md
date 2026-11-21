# Importing a Ren'Py project

Emaki can start a game from a Ren'Py project: its scripts, characters, pictures and sound become a new Emaki game that opens and plays. The Ren'Py project isn't changed. What has no Emaki equivalent is kept in the new scripts as comments and listed in a report, so you can see what's left to do.

## Running it

In the launcher (or Emaki Studio), choose **Import from Ren'Py…** at the bottom of the project list. Pick the Ren'Py project's folder (the one with `game/` in it), where to put the new game and its folder name, then **Import project**. A long game takes a minute or two.

From the command line:

```sh
npm run emaki -- import renpy "path/to/My Ren'Py Game" "path/to/my-emaki-game"
npm run emaki -- import renpy "path/to/My Ren'Py Game" "path/to/my-emaki-game" --title "A New Title"
```

The new folder must not exist yet, or be empty. The importer reads the project's `.rpy` sources, as the Ren'Py launcher keeps them: a released game has only compiled scripts (`.rpyc`, `.rpa` archives), and those are refused.

## What you get

```
my-emaki-game/
  story.vn            the header (title, version, canvas) and every character, picture, sound and variable
  scripts/script.vn   one file for each .rpy file, with its labels
  scripts/chapter1.vn
  assets/             the game's files, as they were in game/
  assets/imported/    pictures made from Ren'Py composites
  import-report.md    what was left out or changed, by file and line
```

The game is compiled at the end of the import. A line that still doesn't compile (most often a picture Ren'Py makes in Python) is commented out as `# renpy (didn't compile): ...`, so the game always opens; a line of dialogue whose only problem is an expression with no picture keeps its words. Everything else that wasn't converted is a `# renpy: ...` comment where it was. Search for `# renpy` to find them all.

## What converts

| Ren'Py | Emaki |
|---|---|
| `define e = Character("Eileen", color="#c8ffc8")` | `define e "Eileen" color=#c8ffc8` |
| `Character(..., image="eileen")` | the character takes the picture's name (`eileen`), since Emaki finds a speaker's picture by their id |
| `DynamicCharacter("player_name")`, `Character("[player]")` | `define mc "{player_name}"`: a name filled in from a variable |
| `default x = 0`, `define x = "text"` | `var x = 0`, `var x = "text"` |
| `default persistent.seen = False` | `global var persistent_seen = false` |
| `image bg room = "bg/room.png"`, `Image(...)`, files in `images/` | `image bg room = "bg/room.png"` |
| `im.Composite`, `LiveComposite`, `Composite` of files | one picture, made at import (`assets/imported/`) |
| `"#000"`, `Solid("#000")` | a picture of that colour |
| an animated image (ATL) | its first picture, still |
| `define audio.theme = "music/theme.ogg"` | `audio theme = "music/theme.ogg"` |
| `label`, `jump`, `call`, `return`, `menu`, `if`/`elif`/`else` | the same; a label that runs on into the next one in its file ends with `jump next` (Emaki labels don't fall through) |
| `e happy "Hello [name]."`, narration, `extend` | `e happy: "Hello {name}."`; `extend` joins the line before with a pause (`[w]`) |
| `{i}`, `{b}`, `{color=}`, `{w}`, `{p}`, `{nw}`, `{rb}{rt}` | `*`, `**`, `[color=]`, `[w]`, `[w]`, `[nw]`, `[ruby=]` |
| `scene`, `show ... at ... zorder N`, `hide` | `scene`, `show ... at x y anchor ... zoom ... depth N`, `hide` |
| `with dissolve`, `fade`, `Dissolve(t)`, `Fade(...)`, `ImageDissolve("rule.png", t)`, `move`, `vpunch` | `with dissolve`, `fade`, `wipe "rule.png"`, `move`, `shake`; other built-in transitions become a dissolve of about their length |
| `play music theme fadein 1`, `stop music fadeout 2`, `voice "v.ogg"`, `queue` | `play music theme fade 1`, `stop music fade 2`, `play voice "v.ogg"`; queued sound plays at once |
| `pause 1.5`, `$ renpy.pause(1.5)` | `wait 1.5` |
| `$ x += 1`, `$ renpy.movie_cutscene("op.webm")`, `$ renpy.jump("x")` | `set x += 1`, `movie "op.webm"`, `jump x` |
| `nvl clear`, characters with `kind=nvl` | `nvl clear`, and `nvl on` / `nvl off` around their lines |

**Positions.** Ren'Py draws a game on a fixed screen (`gui.init(1280, 720)`, which becomes the header's `canvas:`), and pictures at their own size. So shown pictures become [free layers](script-syntax.md#free-layers) placed the same way: `at left` is `at 0% 100% anchor 0% 100%`, and a game's own transforms are read for where they leave a picture (`xalign`, `xpos`, `xcenter`, `yalign`, `ypos`, anchors, `zoom`), including transforms that call other transforms with numbers, like `transform third: slot(426)`. How a transform moves a picture (the easing, `on show` fades) isn't kept, only where it ends up.

## What doesn't

These are listed in `import-report.md` with their file and line:

- **Python**: `python:` and `init python:` blocks, and `$` lines other than assignments and the few calls above. Conditions Emaki can't check (calls, `None`, `in`) become `if false:` with the condition beside it.
- **Screens and styles**: Ren'Py's screen language and `style` blocks. Emaki has its own [screens](theming.md); the game starts with Emaki's built-in title, menus and text box until you make yours.
- **ATL**: animations, and `show ... :` blocks. Images and transforms keep their first picture and their final place.
- **Text input** (`renpy.input`), so a name the player would type keeps its starting value. Set it in `story.vn`.
- Translations in `game/tl/`, `while` loops, `jump expression`, `call screen`, `show screen`, `show expression`, `show text`, `show layer`, label parameters, menus with `set`, and click-to-wait `pause`.
- Things counted rather than listed (the report's last table): `window show`/`hide`, `what_prefix`/`what_suffix`, `ctc`, `behind`, `onlayer`, sound options like `<loop 4.5>`, text tags such as `{size}` and `{font}`.

Composite pictures are written as PNG. To ship them smaller, turn on picture compression when you export (see [making the export smaller](exporting.md#making-the-export-smaller)).
