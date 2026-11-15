# Emaki for VS Code

Write [Emaki](https://github.com/AbhishekNair050/Emaki) visual novel scripts (`.vn`) with:

- **Highlighting** for the header, characters, images, labels, dialogue, choices, conditions, screens, plugin lines, comments (whole-line and end-of-line) and text styling (`*italic*`, `**bold**`, `[color=...]`, `{variables}`).
- **Errors as you type**: the same checks as `emaki check`, underlining the exact name that's wrong, with "did you mean" suggestions. In a game folder, plugin commands and functions are checked against the game's `plugins/*/plugin.json` (re-read when one changes), and problems with a plugin itself show on its `plugin.json`.
- **Go to definition** and **find all references** for labels, characters, images, audio and variables (F12 / Shift+F12).
- **Hover** a name to see what it is: a character's display name, an image's file, a variable's starting value, how much dialogue a label has.
- **Completion**: label names after `jump`/`call`, backgrounds after `scene`, sprites and their expressions after `show` or a speaker's name, transitions after `with`, positions after `at`, variables in `set`, `if` and `{...}`, and your plugins after `@`: their commands, arguments, allowed values and functions.
- **Hover** a plugin command or function to see what its `plugin.json` says about it.
- **Outline** of every label, character, image and variable (Ctrl+Shift+O), and folding by indentation.
- **Preview from this line** (Ctrl+Alt+Enter, or ▷ in the editor title): with `npm run dev` running, opens the game beside your script, starting at the cursor's line. Settings: `emaki.preview.url` (default `http://localhost:5173/`) and `emaki.preview.openIn` (`beside` or `browser`).
- **Format document** (Shift+Alt+F) using `emaki fmt`, which keeps your comments. Scripts with errors are never reformatted.

Comment a line with Ctrl+/. Indentation is two spaces.

## Install from source
Not on the Marketplace yet. From the repository root:

```sh
npm install
npm run build:vscode                 # bundles to packages/vscode/dist/extension.cjs
npm run package -w emaki-vscode      # makes emaki-vscode-0.1.0.vsix
code --install-extension packages/vscode/emaki-vscode-0.1.0.vsix
```

To try changes without installing, open `packages/vscode` in VS Code and press F5 (Run Extension).

## Testing
- `npm test` (from the root) covers the language features and the grammar.
- `VSCODE_PATH=/path/to/Code.exe npm run test:e2e -w emaki-vscode` opens a real VS Code with a throwaway profile, loads the extension, edits a copy of the demo story and prints what happened: errors appearing and clearing, definition, references, hover, outline, completion and formatting. It needs a desktop, so it isn't part of CI.

## How it's built
The features live in `@emaki/language` (`packages/language`): plain functions over text, no VS Code API, shared with the web editor. `src/extension.ts` adapts them to VS Code. The grammar in `syntaxes/` is tested with the same TextMate engine VS Code uses (`test/grammar.test.ts`). The compiler and language features are bundled in, so nothing else needs to be installed.
