/**
 * `emaki plugin <game folder> <name> [--ts]`: start a plugin. Writes
 * plugins/<name>/plugin.json and index.js (or index.ts) with one small
 * command that works as it is, and plugins/emaki-plugin.d.ts, the plugin
 * API's types, so editors complete `ctx.` and check the code.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_NAME } from '@emaki/format';
import { MAIN_FILE } from '@emaki/format/files';
import { PLUGIN_TYPES_FILE, updatePluginTypes } from '@emaki/player-web/plugin-types';

export function starterManifest(name: string, ts: boolean): string {
  return JSON.stringify({
    description: `What @${name} does, shown when hovering it in the editor.`,
    ...(ts ? { main: 'index.ts' } : {}),
    commands: {
      note: { description: 'Show a note over the scene for a moment.', args: { text: 'string', seconds: 'number?' } },
    },
  }, null, 2) + '\n';
}

export function starterCode(name: string, ts: boolean): string {
  const doc = `/**
 * ${name}: a plugin for this game. In the story:
 *
 *   @${name} note text="Hello!" seconds=2
 *
 * plugin.json says what scripts can write (the compiler checks every use);
 * this file does it. See docs/plugins.md for the whole API: commands the
 * story waits on (minigames), lasting effects, screen elements, functions,
 * events, ctx.set for story variables and ctx.storage for the plugin's own data.
 */
`;
  const body = `  /** The notes on screen, so going back or loading can clear them. */
  const notes = new Set${ts ? '<HTMLElement>' : ''}();
  return {
    commands: {
      note(args, run) {
        if (run.instant) return; // skipping: a passing note isn't worth showing
        const note = document.createElement('div');
        note.textContent = String(args.text);
        note.style.cssText = 'position:absolute;left:50%;top:8%;translate:-50% 0;padding:0.6em 1.2em;'
          + 'border-radius:0.5em;background:rgb(0 0 0 / 0.7);color:white;font-size:2.4cqw';
        ctx.layer.append(note);
        notes.add(note);
        setTimeout(() => { note.remove(); notes.delete(note); }, Number(args.seconds ?? 2) * 1000);
      },
    },
    reset() {
      for (const note of notes) note.remove();
      notes.clear();
    },
  };
`;
  const fn = name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
  return ts
    ? `${doc}import type { PluginSetup } from '../emaki-plugin';\n\nconst ${fn}: PluginSetup = (ctx) => {\n${body}};\n\nexport default ${fn};\n`
    : `${doc}\n/** @type {import('../emaki-plugin').PluginSetup} */\nexport default function ${fn}(ctx) {\n${body}}\n`;
}

/** Write the plugin; returns the files written, relative to the game. */
export function newPlugin(gameDir: string, name: string, ts = false): string[] {
  if (!existsSync(join(gameDir, MAIN_FILE))) throw new Error(`'${gameDir}' isn't a game folder (it has no ${MAIN_FILE})`);
  if (!PLUGIN_NAME.test(name)) throw new Error(`A plugin's name is lowercase letters, digits and _, starting with a letter (it's what scripts write after @)`);
  const folder = join(gameDir, 'plugins', name);
  if (existsSync(folder)) throw new Error(`plugins/${name}/ already exists`);
  mkdirSync(folder, { recursive: true });
  const code = ts ? 'index.ts' : 'index.js';
  writeFileSync(join(folder, 'plugin.json'), starterManifest(name, ts));
  writeFileSync(join(folder, code), starterCode(name, ts));
  updatePluginTypes(gameDir, true);
  return [`plugins/${name}/plugin.json`, `plugins/${name}/${code}`, PLUGIN_TYPES_FILE];
}
