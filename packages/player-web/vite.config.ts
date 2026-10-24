import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { gameConfig } from './src/build.ts';

const repo = resolve(import.meta.dirname, '../..');
// Which game to run: EMAKI_GAME=path/to/game npm run dev
const game = resolve(repo, process.env.EMAKI_GAME ?? 'games/gullwing');

export default defineConfig(gameConfig(game, resolve(game, 'dist')));
