/**
 * Emaki editor: the script, the running game and a flowchart of the story,
 * side by side and always pointing at the same place.
 *
 *  - type in the script → the game updates in place (same line, same music)
 *  - Ctrl+Enter → play from the cursor
 *  - click a scene in the flowchart → jump to it in the script; double-click → play it
 *  - the game's current line is marked in the script, its scene in the flowchart
 */
import { buildGraph, compile, type CompiledStory } from '@emaki/format';
import { Player } from '@emaki/player-web';
import '@emaki/player-web/style.css';
import '@emaki/player-web/fonts';
import { Flowchart } from './flowchart.ts';
import { ScriptPane } from './script/script-pane.ts';
import { StorySync, type SaveStatus, type StoryText } from './sync.ts';
import './editor.css';

const COMPILE_DELAY_MS = 250;
const SPLIT_KEY = 'emaki-editor:split';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

async function main(): Promise<void> {
  const initial = await loadStory();
  if (!initial) return;

  const playerHost = $('.player-host');
  const gameNote = $('.game-note');
  const problemsBtn = $<HTMLButtonElement>('#problems');
  const status = $('.save-status');

  let player: Player | null = null;
  let story: CompiledStory | null = null;
  let compileTimer = 0;

  const flow = new Flowchart($('.flow-host'), {
    reveal: (label) => revealLabel(label),
    play: (label) => { flush(); player?.jumpTo(label); },
  });

  const sync = new StorySync(initial, {
    status: (s, detail) => showStatus(s, detail),
    reload: (text) => { script.setText(text); recompile(text); },
    conflict: (theirs) => showConflict(theirs),
  });

  const script = new ScriptPane($('.cm-host'), initial.text, {
    onChange: (text) => { sync.changed(text); scheduleCompile(); },
    onRun: (line) => runFrom(line),
    onCursor: (line) => flow.setCursor(labelAt(line)),
    onSave: () => void sync.saveNow(),
  });

  recompile(initial.text);
  script.revealLine(1, true, false);

  // ---------------------------------------------------------------- compile → game

  function scheduleCompile(): void {
    window.clearTimeout(compileTimer);
    compileTimer = window.setTimeout(() => recompile(script.text), COMPILE_DELAY_MS);
  }

  /** Apply pending edits before acting on the game. */
  function flush(): void {
    if (!compileTimer) return;
    window.clearTimeout(compileTimer);
    recompile(script.text);
  }

  function recompile(text: string): void {
    compileTimer = 0;
    const r = compile(text);
    const errors = r.diagnostics.filter((d) => d.severity === 'error').length;
    const warnings = r.diagnostics.length - errors;
    problemsBtn.textContent = errors ? `✕ ${plural(errors, 'error')}` : warnings ? `⚠ ${plural(warnings, 'warning')}` : '✓ No problems';
    problemsBtn.className = errors ? 'has-errors' : warnings ? 'has-warnings' : '';

    if (!r.story) {
      gameNote.textContent = story ? 'The script has errors: the game is running the last version that worked.' : 'Fix the errors in the script to start the game.';
      return;
    }
    gameNote.textContent = '';
    story = r.story;
    document.title = `${story.meta.title ?? 'Untitled'} · Emaki editor`;
    $('.story-title').textContent = story.meta.title ?? 'Untitled';
    flow.update(story, buildGraph(r.program));
    if (!player) startPlayer(story);
    else if (!player.reload(story)) flashNote('Couldn’t find the line the game was on after that edit, so it went back to the title screen.');
  }

  function startPlayer(s: CompiledStory): void {
    player?.destroy();
    player = new Player(playerHost, s, {
      onUpdate: (block) => {
        const line = block && 'line' in block ? block.line : null;
        script.setPlayLine(line);
        flow.setCurrent(block && 'label' in block ? block.label : null);
      },
    });
    player.boot();
  }

  function runFrom(line: number): void {
    flush();
    if (!player) return;
    player.jumpToLine(line);
    // Leave the keyboard with the script, so writing can carry on straight away.
  }

  // ---------------------------------------------------------------- script ↔ flowchart

  function labelAt(line: number): string | null {
    const zero = line - 1;
    const hit = script.analysis.symbols().find((s) => s.kind === 'label' && zero >= s.line && zero <= s.endLine);
    return hit?.name ?? null;
  }

  function revealLabel(label: string): void {
    const sym = script.analysis.symbols().find((s) => s.kind === 'label' && s.name === label);
    if (sym) script.revealLine(sym.line + 1);
  }

  // ---------------------------------------------------------------- top bar

  $('#run').addEventListener('click', () => runFrom(script.cursorLine));
  $('#restart').addEventListener('click', () => { flush(); if (story) startPlayer(story); });
  problemsBtn.addEventListener('click', () => script.showProblems());
  $('#format').addEventListener('click', () => {
    if (!script.format()) flashNote('Fix the errors first: formatting never touches a script that doesn’t parse.');
  });

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || !(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'Enter') { e.preventDefault(); runFrom(script.cursorLine); }
    if (e.key === 's') { e.preventDefault(); void sync.saveNow(); }
  });

  window.addEventListener('beforeunload', (e) => {
    if (sync.dirty) e.preventDefault();
  });

  import.meta.hot?.on('emaki:story-changed', (data: { version: string }) => void sync.external(data.version));

  function showStatus(s: SaveStatus, detail?: string): void {
    const text: Record<SaveStatus, string> = {
      saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…', conflict: 'Changed in two places', error: 'Not saved',
    };
    status.textContent = text[s];
    status.dataset.status = s;
    status.title = detail ?? (s === 'saved' ? 'story.vn on disk matches the editor' : '');
  }

  function showConflict(theirs: StoryText): void {
    const banner = $('.conflict');
    banner.hidden = false;
    const done = () => { banner.hidden = true; };
    $('#keep-mine').onclick = () => { done(); void sync.keepMine(); };
    $('#take-theirs').onclick = () => { done(); sync.takeTheirs(); };
    $('#conflict-lines').textContent = `The file on disk has ${plural(theirs.text.split('\n').length, 'line')}; the editor has ${plural(script.text.split('\n').length, 'line')}.`;
  }

  let noteTimer = 0;
  function flashNote(text: string): void {
    gameNote.textContent = text;
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => { if (gameNote.textContent === text) gameNote.textContent = ''; }, 6000);
  }

  setupSplitter();
}

async function loadStory(): Promise<StoryText | null> {
  try {
    const res = await fetch('/__emaki/story');
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as StoryText;
  } catch (err) {
    document.body.innerHTML = '<p class="fatal">Couldn’t load story.vn from the editor server. Is <code>npm run edit</code> still running?</p>';
    console.error(err);
    return null;
  }
}

/** Drag (or arrow-key) the bar between the script and the game to resize them. */
function setupSplitter(): void {
  const workspace = $('.workspace');
  const bar = $('.splitter');
  const apply = (pct: number) => {
    const v = Math.min(75, Math.max(25, pct));
    workspace.style.setProperty('--split', `${v}%`);
    bar.setAttribute('aria-valuenow', String(Math.round(v)));
    try { localStorage.setItem(SPLIT_KEY, String(v)); } catch { /* storage unavailable */ }
  };
  let stored = NaN;
  try { stored = Number(localStorage.getItem(SPLIT_KEY)); } catch { /* storage unavailable */ }
  if (Number.isFinite(stored) && stored > 0) apply(stored);

  bar.addEventListener('pointerdown', (e) => {
    bar.setPointerCapture(e.pointerId);
    const rect = workspace.getBoundingClientRect();
    const move = (ev: PointerEvent) => apply(((ev.clientX - rect.left) / rect.width) * 100);
    const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
  bar.addEventListener('keydown', (e) => {
    const now = Number(bar.getAttribute('aria-valuenow') ?? 50);
    if (e.key === 'ArrowLeft') apply(now - 5);
    if (e.key === 'ArrowRight') apply(now + 5);
  });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

void main();
