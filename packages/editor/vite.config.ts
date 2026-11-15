import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { emakiEditor } from './src/server/plugin.ts';

const here = import.meta.dirname;
const repo = resolve(here, '../..');
// Which game to edit: EMAKI_GAME=path/to/game npm run edit
const game = resolve(repo, process.env.EMAKI_GAME ?? 'games/gullwing');

export default defineConfig({
  root: here,
  plugins: [emakiEditor(game)],
  server: {
    port: 5174,
    // The game folder may be outside the repo; its theme.css and fonts load from there.
    fs: { allow: [repo, game] },
  },
});
