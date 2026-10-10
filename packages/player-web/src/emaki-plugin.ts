/**
 * Vite plugin: compiles the game's story.vn on the fly and exposes it as
 * `virtual:emaki-game`. Editing the .vn file triggers a reload; the player
 * resumes at the same line (see Runner.resume).
 */
import { readFileSync } from 'node:fs';
import { normalize, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { buildGraph, compile } from '@emaki/format';

const VIRTUAL = 'virtual:emaki-game';
const RESOLVED = '\0' + VIRTUAL;

export function emakiGame(gameDir: string): Plugin {
  const storyPath = resolve(gameDir, 'story.vn');
  let devServer = false;

  return {
    name: 'emaki-game',
    configResolved(config) {
      devServer = config.command === 'serve';
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      this.addWatchFile(storyPath);
      const source = readFileSync(storyPath, 'utf8');
      const r = compile(source);
      for (const d of r.diagnostics) {
        const msg = `story.vn:${d.line}: ${d.severity}: ${d.message}`;
        if (d.severity === 'error') this.warn(msg); else this.info?.(msg);
      }
      return [
        `export const story = ${JSON.stringify(r.story)};`,
        `export const diagnostics = ${JSON.stringify(r.diagnostics)};`,
        `export const sourceLines = ${JSON.stringify(source.replace(/\r\n?/g, '\n').split('\n'))};`,
        // The story map is a dev tool: never ship a spoiler map of the routes in a build.
        `export const graph = ${JSON.stringify(devServer && r.story ? buildGraph(r.program) : null)};`,
      ].join('\n');
    },
    handleHotUpdate({ file, server }) {
      if (normalize(file) !== normalize(storyPath)) return;
      const mod = server.moduleGraph.getModuleById(RESOLVED);
      if (mod) server.moduleGraph.invalidateModule(mod);
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}
