import { resolve } from 'node:path';
import type { InlineConfig } from 'vite';
import { emakiEditor } from './plugin.ts';

/** Shared by the editor command, launcher and the repository's Vite config. */
export function editorConfig(gameDir: string): InlineConfig {
  const root = resolve(import.meta.dirname, '../..');
  return {
    root,
    plugins: [emakiEditor(gameDir)],
    server: { port: 5174, fs: { allow: [resolve(root, '../..'), gameDir] } },
  };
}
