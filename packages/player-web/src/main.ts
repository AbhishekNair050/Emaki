import { diagnostics, sourceLines, story } from 'virtual:emaki-game';
import { Player } from './player.ts';
import './style.css';

const app = document.getElementById('app')!;

if (!story) {
  // Compile errors: show them instead of the game (dev only, a build would have failed).
  app.className = 'compile-errors';
  const list = diagnostics
    .filter((d) => d.severity === 'error')
    .map((d) => {
      const src = sourceLines[d.line - 1]?.trim() ?? '';
      return `<li><b>story.vn:${d.line}</b> ${escape(d.message)}<pre>${escape(src)}</pre></li>`;
    })
    .join('');
  app.innerHTML = `<h1>Your story has errors</h1><p>Fix these and save; the page reloads by itself.</p><ul>${list}</ul>`;
} else {
  document.title = story.meta.title ?? 'Emaki';
  new Player(app, story, { dev: import.meta.env.DEV }).boot();
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
