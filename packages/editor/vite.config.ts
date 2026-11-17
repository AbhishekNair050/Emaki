import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { editorConfig } from './src/server/config.ts';

const here = import.meta.dirname;
const repo = resolve(here, '../..');
// Which game to edit: EMAKI_GAME=path/to/game npm run edit
const game = resolve(repo, process.env.EMAKI_GAME ?? 'games/gullwing');

export default defineConfig(editorConfig(game));
