/**
 * Building a game for the web: the Vite setup shared by `npm run dev`,
 * `npm run build:demo` and `emaki export` (whose desktop and phone apps wrap
 * this same build).
 */
import { resolve } from 'node:path';
import { build, type InlineConfig } from 'vite';
import { emakiGame } from './emaki-plugin.ts';

const playerDir = resolve(import.meta.dirname, '..');
const repo = resolve(playerDir, '../..');

/** Vite config for playing or building the game in `gameDir`. */
export function gameConfig(gameDir: string, outDir: string): InlineConfig {
  return {
    root: playerDir,
    // Relative URLs, so the build works from any folder, an app:// scheme or a phone's web view.
    base: './',
    publicDir: resolve(gameDir, 'assets'),
    plugins: [emakiGame(gameDir)],
    build: { outDir, emptyOutDir: true },
    server: { fs: { allow: [repo, gameDir] } },
  };
}

/** Build the game into `outDir` (index.html plus assets). */
export async function buildWeb(gameDir: string, outDir: string, opts: { quiet?: boolean } = {}): Promise<void> {
  await build({ ...gameConfig(gameDir, outDir), configFile: false, logLevel: opts.quiet ? 'warn' : 'info' });
}
