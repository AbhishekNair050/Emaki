/**
 * Searches a story's routes off the main thread (D-065). It is sent the script's text, not the compiled story:
 * copying text to a worker is cheap, copying a long game's compiled code isn't. It compiles the text itself,
 * with its own cache, so a search after a small edit recompiles only what changed.
 */
import { compileFiles, createCompileCache, type PluginManifest, type StoryFile } from '@emaki/format';
import { findRoutes } from '@emaki/runtime';

interface Request { id: number; main: string; parts: StoryFile[]; plugins: Record<string, PluginManifest>; budgetMs: number }

const cache = createCompileCache();
const scope = self as unknown as { onmessage: ((e: MessageEvent<Request>) => void) | null; postMessage(message: unknown): void };
scope.onmessage = (e) => {
  const { id, main, parts, plugins, budgetMs } = e.data;
  const r = compileFiles(main, parts, { plugins, cache });
  scope.postMessage({ id, result: r.story ? findRoutes(r.story, { budgetMs }) : { routes: [], complete: false, states: 0, ms: 0, entries: {} } });
};
