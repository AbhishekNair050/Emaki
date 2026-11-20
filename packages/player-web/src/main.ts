// The player's styles first: the game module imports the game's theme.css, which must come after.
import './style.css';
import './fonts.ts';
import { loadGame } from 'virtual:emaki-game';
import { plugins } from 'virtual:emaki-plugins';
import type { CompiledStory, CompiledTranslation, StoryGraph } from '@emaki/format';
import { Player } from './player.ts';

const app = document.getElementById('app')!;

void start();

async function start(): Promise<void> {
  const { story, translations, diagnostics, sourceLines, graph, renamed } = await loadGame();
  if (!story) {
    // Compile errors: show them instead of the game (dev only, a build would have failed).
    app.className = 'compile-errors';
    const list = diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => {
        const src = sourceLines[d.file ?? '']?.[d.line - 1]?.trim() ?? '';
        return `<li><b>${escape(d.file ?? 'story.vn')}:${d.line}</b> ${escape(d.message)}<pre>${escape(src)}</pre></li>`;
      })
      .join('');
    app.innerHTML = `<h1>Your story has errors</h1><p>Fix these and save; the page reloads by itself.</p><ul>${list}</ul>`;
  } else {
    document.title = story.meta.title ?? 'Emaki';
    if (import.meta.env.DEV && graph) void startWithMap(story, graph, translations);
    else new Player(app, story, { dev: import.meta.env.DEV, translations, ownsDocument: true, plugins, ...(renamed ? { renamed } : {}) }).boot();
  }
}

/** Dev server: the game plus the story map panel (loaded lazily, never part of a build). */
async function startWithMap(s: CompiledStory, g: StoryGraph, translations: CompiledTranslation[]): Promise<void> {
  const { StoryMap } = await import('./map/story-map.ts');
  const stageHost = document.createElement('div');
  app.replaceChildren(stageHost);
  let player: Player | null = null;
  const map = new StoryMap(s, g, {
    jumpTo: (label) => player?.jumpTo(label),
    setVar: (name, value) => player?.setVar(name, value),
    getVars: () => player?.vars ?? s.vars,
  });
  map.mount(app);
  player = new Player(stageHost, s, { dev: true, translations, ownsDocument: true, plugins, onUpdate: (b) => map.update(b) });
  player.boot();
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
