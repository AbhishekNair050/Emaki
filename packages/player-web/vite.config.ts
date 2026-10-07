import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { emakiGame } from './src/emaki-plugin.ts';

const here = import.meta.dirname;
const repo = resolve(here, '../..');
// Which game to run: EMAKI_GAME=path/to/game npm run dev
const game = resolve(repo, process.env.EMAKI_GAME ?? 'games/gullwing');

export default defineConfig({
  root: here,
  base: './',
  publicDir: resolve(game, 'assets'),
  plugins: [emakiGame(game)],
  build: {
    outDir: resolve(game, 'dist'),
    emptyOutDir: true,
  },
  server: {
    fs: { allow: [repo] },
  },
});
