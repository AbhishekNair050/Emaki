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
- `title_image`: background for the title screen (asset path).

## Declarations (top level, no indentation)
| Line | Meaning |
|---|---|
| `define mira "Mira" color=#e8b04b` | A character. `mira` is what you type; `"Mira"` is what players see. |
| `image kitchen = "bg/kitchen.png"` | A background or any image. Paths are relative to the game's `assets/` folder. |
| `image mira smile = "sprites/mira_smile.png"` | A character image: first word is the **tag** (`mira`), the rest are **attributes** (`smile`). |
| `audio rain = "audio/rain.ogg"` | A named sound. |
| `var trust = 0` | A variable with its starting value. Numbers, `"text"`, `true`/`false`. Must be declared before use. |
| `label name:` | A scene of your story. Everything indented under it runs in order. |

Full-line comments start with `#`.

## Story lines (indented under a label)
| Line | Meaning |
|---|---|
| `"Some narration."` | Narration (no speaker). |
| `mira: Some dialogue.` | Mira speaks. Quotes are optional: `mira: "Hi."` works too. |
| `mira smile: Glad you came.` | Mira speaks **and** switches to her `smile` image (if she's on screen). |
| `scene kitchen with fade` | New background; clears characters. `scene black` for a black screen. |
| `show mira smile at left with dissolve` | Show (or change) a character. Positions: `left`, `center`, `right`. |
| `hide mira with dissolve` | Remove a character. |
| `play music "audio/theme.ogg"` / `play sound rain` | Audio. Music loops by default. Options: `loop`, `noloop`, `fade 1.5`. |
| `stop music fade 2` | Stop a channel (`music`, `sound`, `voice`). |
| `set trust += 1` | Change a variable. Also `=` and `-=`. |
| `jump label_name` | Go to another label (no coming back). |
| `call label_name` / `return` | Visit a label and come back when it ends. |
| `wait 1.5` | Pause for 1.5 seconds. |
| `end` | The story ends here. |

Transitions: `fade` (through black), `dissolve` (crossfade), `none`.

Reaching the end of a label **returns** to whoever `call`ed it; if nobody did, the story ends. Labels never "fall through" into the next one.

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

## Variables in text
`mira: You've earned {trust} points of my trust.` Use `{{` and `}}` for literal braces.

## Errors
`npm run check` (or the dev player) lists every problem with its line number and a suggested fix, e.g.
`story.vn:52: Unknown name 'kitchen_tlak'. Did you mean 'kitchen_talk'?`

## Not yet supported (planned)
Text styling (bold/italic/colour), custom positions and animations, layered sprites, NVL mode, voice-line auto-mapping, localization files, explicit line ids, inline comments, plugins.
