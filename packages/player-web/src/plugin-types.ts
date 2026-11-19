/**
 * The plugin API's types for a game's plugins: a copy of plugin-api.d.ts at
 * plugins/emaki-plugin.d.ts, so editors complete `ctx.` and check plugin code
 * (a JSDoc `@type` line in JavaScript, an import in TypeScript). The copy is
 * written by `emaki plugin` and kept current whenever the game is played,
 * edited or built.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const PLUGIN_TYPES_FILE = 'plugins/emaki-plugin.d.ts';

const HEADER = '// Written by Emaki: the plugin API as this version of the engine has it. Changes here are replaced.\n';

/** The text of the types file. */
export function pluginTypes(): string {
  return HEADER + readFileSync(join(import.meta.dirname, 'plugin-api.d.ts'), 'utf8');
}

/**
 * Bring a game's copy of the types up to date. Without `create`, only a game
 * that has plugins gets one. Returns whether the file was written.
 */
export function updatePluginTypes(gameDir: string, create = false): boolean {
  const file = join(gameDir, PLUGIN_TYPES_FILE);
  if (!create && !existsSync(dirname(file))) return false;
  const text = pluginTypes();
  try {
    if (existsSync(file) && readFileSync(file, 'utf8') === text) return false;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return true;
  } catch {
    return false; // a read-only game folder still plays
  }
}
