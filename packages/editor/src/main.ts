/**
 * Emaki editor: the script, the running game and a flowchart of the story,
 * side by side and always pointing at the same place.
 *
 *  - type in the script → the game updates in place (same line, same music)
 *  - Ctrl+Enter → play from the cursor
 *  - click a scene in the flowchart → jump to it in the script; double-click → play it
 *  - the game's current line is marked in the script, its scene in the flowchart
 *  - shape the story in the flowchart (add, rename, delete, connect scenes)
 *  - drag images and audio from the asset browser (or your computer) onto the script
 *  - a story can span several files: pick one above the script, or add one
 */
import { buildGraph, compileFiles, voiceMap, type CompiledStory, type Diagnostic, type Stmt } from '@emaki/format';
import {
  addScene, connectScenes, declareAsset, deleteScene, dropAsset, renameScene, type EditResult, type SceneContext, type StorySymbol,
} from '@emaki/language';
import { Player } from '@emaki/player-web';
import '@emaki/player-web/style.css';
import '@emaki/player-web/fonts';
// The game's own theme.css, after the player's styles, as in the game.
import 'virtual:emaki-theme';
import { manifests as pluginManifests, plugins } from 'virtual:emaki-plugins';
import { AssetPanel, type AssetInfo } from './assets.ts';
import { Flowchart } from './flowchart.ts';
import { ScriptPane } from './script/script-pane.ts';
import { StorySync, type SaveStatus, type StoryText } from './sync.ts';
import './editor.css';

const COMPILE_DELAY_MS = 250;
const MAIN = 'story.vn';

/** One file of the story, as the editor holds it. */
interface Doc {
  path: string;
  text: string;
  sync: StorySync;
}
const SPLIT_KEY = 'emaki-editor:split';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

async function main(): Promise<void> {
  const loaded = await loadFiles();
  if (!loaded) return;
  const initial = loaded.get(MAIN)!;
  const docs = new Map<string, Doc>();
  let active = MAIN;
  const doc = (path = active) => docs.get(path)!;
  const fileSelect = $<HTMLSelectElement>('#file');

  const playerHost = $('.player-host');
  const gameNote = $('.game-note');
  const problemsBtn = $<HTMLButtonElement>('#problems');
  const status = $('.save-status');

  let player: Player | null = null;
  let story: CompiledStory | null = null;
  /** Every file in the game's assets/ folder, for finding voice files. */
  let assetPaths = new Set<string>();
  let lastDiagnostics: Diagnostic[] = [];
  /** Where the game is: the line it shows, and which file that's in. */
  let playing: { line: number; file?: string } | null = null;
  let compileTimer = 0;

  /** Apply a structural edit to the open file (undoable there), or return why it couldn't be done. */
  const apply = (r: EditResult): string | null => {
    if (!r.ok) return r.error;
    script.applyEdit(r.text, r.line);
    flush();
    return null;
  };

  /** Which file defines a scene. */
  const fileOfLabel = (label: string): string | undefined => {
    const sym = script.analysis.symbols().find((s) => s.kind === 'label' && s.name === label);
    return sym ? sym.file ?? MAIN : undefined;
  };
  /** What the other files hold, for an edit to `path`. */
  const sceneContext = (path: string): SceneContext => ({
    others: script.analysis.symbols().filter((s) => s.kind === 'label' && (s.file ?? MAIN) !== path).map((s) => s.name),
    ...(story ? { start: Object.entries(story.labels).find(([, pc]) => pc === story!.start)?.[0] } : {}),
  });
  /** Open the file a scene is in, then edit it there. */
  const inFileOf = (label: string, edit: (text: string, ctx: SceneContext) => EditResult): string | null => {
    const path = fileOfLabel(label);
    if (!path) return `There is no scene called '${label}'.`;
    if (path !== active) openFile(path);
    return apply(edit(script.text, sceneContext(path)));
  };

  const flow = new Flowchart($('.flow-host'), {
    reveal: (label) => revealLabel(label),
    revealLine: (line, file) => { if ((file ?? MAIN) !== active) openFile(file ?? MAIN); script.revealLine(line); },
    play: (label) => { flush(); player?.jumpTo(label); },
    addScene: (name, after) => {
      if (after && fileOfLabel(after) && fileOfLabel(after) !== active) openFile(fileOfLabel(after)!);
      return apply(addScene(script.text, name, after ?? undefined, sceneContext(active)));
    },
    renameScene: (from, to) => renameEverywhere(from, to),
    deleteScene: (name) => {
      const refs = script.analysis.symbols().length && story ? referencesElsewhere(name) : [];
      if (refs.length) return `Other scenes still lead to '${name}': ${refs.join(', ')}. Change those first.`;
      return inFileOf(name, (text, ctx) => deleteScene(text, name, ctx));
    },
    connect: (from, to) => inFileOf(from, (text, ctx) => connectScenes(text, from, to, ctx)),
  });

  /** Rename a scene in the file that has it, and the jumps to it in every file. */
  function renameEverywhere(from: string, to: string): string | null {
    const home = fileOfLabel(from);
    if (!home) return `There is no scene called '${from}'.`;
    // Check every file first, so a rename is never half done.
    const results = new Map<string, EditResult>();
    for (const d of docs.values()) {
      const text = d.path === active ? script.text : d.text;
      const r = renameScene(text, from, to, sceneContext(d.path));
      if (!r.ok) return d.path === MAIN || docs.size === 1 ? r.error : `${d.path}: ${r.error}`;
      if (r.text !== text) results.set(d.path, r);
    }
    for (const [path, r] of results) {
      if (path === active || !r.ok) continue;
      const d = doc(path);
      d.text = r.text;
      d.sync.changed(r.text);
    }
    if (home !== active) openFile(home);
    const own = results.get(active);
    if (own?.ok) script.applyEdit(own.text, own.line);
    script.contextChanged();
    flush();
    return null;
  }

  /** Jumps and calls to `label` from files other than the one it's in, as "scene (file line n)". */
  function referencesElsewhere(label: string): string[] {
    const home = fileOfLabel(label);
    const out: string[] = [];
    const visit = (stmts: Stmt[], from: string) => {
      for (const s of stmts) {
        if ((s.type === 'jump' || s.type === 'call') && s.target === label && (s.loc.file ?? MAIN) !== home) out.push(`${from} (${s.loc.file ?? MAIN} line ${s.loc.line})`);
        if (s.type === 'menu') for (const c of s.choices) visit(c.body, from);
        if (s.type === 'if') for (const b of s.branches) visit(b.body, from);
      }
    };
    for (const l of script.analysis.program.labels) visit(l.body, l.name);
    return out;
  }

  const assets = new AssetPanel($('.assets-host'), {
    listed: (list) => {
      const before = assetPaths;
      assetPaths = new Set(list.map((a) => a.path));
      // Voice files came or went: the game pane should hear them.
      if (story?.meta.voice && (before.size !== assetPaths.size || [...assetPaths].some((p) => !before.has(p)))) recompile();
    },
    declaredName: (a) => declaredIn(a),
    declare: (a) => apply(declareAsset(script.text, a.kind, a.path)),
    reveal: (name, a) => {
      const decl = (a.kind === 'image' ? script.analysis.program.images : script.analysis.program.audio).find((d) => d.name === name);
      if (decl) script.revealLine(decl.loc.line);
    },
    addFiles: async (files) => {
      const added = await upload(files);
      for (const a of added) {
        const err = apply(declareAsset(script.text, a.kind, a.path));
        if (err) throw new Error(err);
      }
      assets.say(added.length === 1 ? `Added ${added[0]!.path}.` : `Added ${added.length} files.`);
      await assets.refresh();
    },
  });

  /** The name the script gives an asset file, from the cached analysis of the current text. */
  function declaredIn(a: AssetInfo): string | undefined {
    const p = script.analysis.program;
    return (a.kind === 'image' ? p.images : p.audio).find((d) => d.path.replace(/^\.?\//, '') === a.path)?.name;
  }

  const addDoc = (path: string, text: StoryText): Doc => {
    const d: Doc = {
      path,
      text: text.text,
      sync: new StorySync(text, {
        status: (s, detail) => { statuses.set(path, s); if (path === active) showStatus(s, detail); updateFileList(); },
        reload: (t) => {
          d.text = t;
          if (path === active) script.setText(t);
          else script.contextChanged();
          recompile();
        },
        conflict: (theirs) => { if (path !== active) openFile(path); showConflict(theirs); },
      }, { url: `/__emaki/story?file=${encodeURIComponent(path)}` }),
    };
    docs.set(path, d);
    return d;
  };
  const statuses = new Map<string, SaveStatus>();
  for (const [path, text] of loaded) addDoc(path, text);

  /** The screen the cursor is in (shown in the game), if any; see previewAt. */
  let previewing: string | null = null;
  const script = new ScriptPane($('.cm-host'), initial.text, {
    onChange: (text) => { doc().text = text; doc().sync.changed(text); scheduleCompile(); },
    onRun: (line) => runFrom(line),
    onCursor: (line) => { flow.setCursor(labelAt(line)); previewAt(line); },
    onSave: () => void doc().sync.saveNow(),
    onDrop: (drop, line) => void dropOnScript(drop, line),
    context: () => ({
      file: active,
      files: docs.size > 1 ? [...docs.values()].map((d) => ({ path: d.path, source: d.text })) : [],
      plugins: pluginManifests,
    }),
    openDefinition: (sym) => openSymbol(sym),
  }, MAIN);

  /** Show another file of the story in the script pane. */
  function openFile(path: string): void {
    if (!docs.has(path) || path === active) return;
    active = path;
    script.open(path, doc().text);
    fileSelect.value = path;
    $('.conflict').hidden = true;
    const s = statuses.get(path) ?? 'saved';
    showStatus(s);
    script.setPlayLine(playing && (playing.file ?? MAIN) === path ? playing.line : null);
  }

  function openSymbol(sym: StorySymbol): void {
    openFile(sym.file ?? MAIN);
    script.revealLine(sym.line + 1);
  }

  function updateFileList(): void {
    const errors = new Set(lastDiagnostics.filter((d) => d.severity === 'error').map((d) => d.file ?? MAIN));
    const paths = [...docs.keys()].sort((a, b) => (a === MAIN ? -1 : b === MAIN ? 1 : a.localeCompare(b)));
    fileSelect.replaceChildren(...paths.map((p) => {
      const o = document.createElement('option');
      o.value = p;
      const unsaved = statuses.get(p) && statuses.get(p) !== 'saved' ? ' •' : '';
      o.textContent = `${p}${errors.has(p) ? ' ✕' : ''}${unsaved}`;
      return o;
    }));
    fileSelect.value = active;
  }
  fileSelect.addEventListener('change', () => { openFile(fileSelect.value); script.view.focus(); });

  $('#new-file').addEventListener('click', () => void newFile());
  async function newFile(): Promise<void> {
    const name = prompt('Name of the new file (for example chapter2.vn or routes/mira.vn):');
    if (!name?.trim()) return;
    const res = await fetch('/__emaki/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: name }) });
    const body = (await res.json()) as { path?: string; error?: string };
    if (!res.ok || !body.path) { flashNote(body.error ?? `Couldn’t create the file (${res.status}).`); return; }
    await refreshFiles();
    openFile(body.path);
    script.view.focus();
  }

  /** Files were added or removed on disk (or by us). */
  async function refreshFiles(): Promise<void> {
    const res = await fetch('/__emaki/files');
    const { files } = (await res.json()) as { files: string[] };
    for (const path of files) {
      if (docs.has(path)) continue;
      const r = await fetch(`/__emaki/story?file=${encodeURIComponent(path)}`);
      if (r.ok) addDoc(path, (await r.json()) as StoryText);
    }
    for (const path of [...docs.keys()]) {
      if (files.includes(path) || doc(path).sync.dirty) continue;
      docs.delete(path);
      script.forget(path);
      if (path === active) openFile(MAIN);
    }
    script.contextChanged();
    updateFileList();
    recompile();
  }

  recompile();
  updateFileList();
  script.revealLine(1, true, false);
  void assets.refresh();
  setupTabs();

  /** An asset (or files from the computer) dropped onto line `line` of the script. */
  async function dropOnScript(drop: { asset?: { path: string; kind: 'image' | 'audio' }; files?: File[] }, line: number): Promise<void> {
    try {
      const items = drop.asset ? [drop.asset] : await upload(drop.files ?? []);
      let at = line;
      for (const a of items) {
        const r = dropAsset(script.text, a.kind, a.path, at);
        const err = apply(r);
        if (err) { flashNote(err); return; }
        if (r.ok) at = r.line + 1;
      }
      if (drop.files) await assets.refresh();
    } catch (err) {
      flashNote(err instanceof Error ? err.message : String(err));
    }
  }

  // ---------------------------------------------------------------- compile → game

  function scheduleCompile(): void {
    window.clearTimeout(compileTimer);
    compileTimer = window.setTimeout(() => recompile(), COMPILE_DELAY_MS);
  }

  /** Apply pending edits before acting on the game. */
  function flush(): void {
    if (!compileTimer) return;
    window.clearTimeout(compileTimer);
    recompile();
  }

  /** Compile every file of the story (the open one as it is in the editor). */
  function recompile(): void {
    compileTimer = 0;
    doc().text = script.text;
    const parts = [...docs.values()].filter((d) => d.path !== MAIN).map((d) => ({ path: d.path, source: d.text }));
    const r = compileFiles(doc(MAIN).text, parts, { plugins: pluginManifests });
    const hadErrors = new Set(lastDiagnostics.filter((d) => d.severity === 'error').map((d) => d.file ?? MAIN)).size;
    lastDiagnostics = r.diagnostics;
    const nowErrors = new Set(r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.file ?? MAIN)).size;
    if (docs.size > 1 && (hadErrors || nowErrors)) updateFileList();
    if (docs.size > 1) script.contextChanged();
    const errors = r.diagnostics.filter((d) => d.severity === 'error').length;
    const warnings = r.diagnostics.length - errors;
    problemsBtn.textContent = errors ? `✕ ${plural(errors, 'error')}` : warnings ? `⚠ ${plural(warnings, 'warning')}` : '✓ No problems';
    problemsBtn.className = errors ? 'has-errors' : warnings ? 'has-warnings' : '';
    const elsewhere = r.diagnostics.filter((d) => d.severity === 'error' && (d.file ?? MAIN) !== active);
    problemsBtn.title = elsewhere.length ? `Also in ${[...new Set(elsewhere.map((d) => d.file ?? MAIN))].join(', ')} (marked ✕ in the file list)` : 'List problems (Ctrl+Shift+M)';

    if (!r.story) {
      gameNote.textContent = story ? 'The script has errors: the game is running the last version that worked.' : 'Fix the errors in the script to start the game.';
      return;
    }
    gameNote.textContent = '';
    story = r.story;
    // A voiced game's lines play their files here too (the files the assets folder has).
    const voices = voiceMap(story, (path) => assetPaths.has(path));
    if (Object.keys(voices).length) story.voices = voices;
    document.title = `${story.meta.title ?? 'Untitled'} · Emaki editor`;
    $('.story-title').textContent = story.meta.title ?? 'Untitled';
    flow.update(story, buildGraph(r.program));
    assets.scriptChanged();
    if (!player) startPlayer(story);
    else if (!player.reload(story)) flashNote('Couldn’t find the line the game was on after that edit, so it went back to the title screen.');
    if (previewing) player?.previewScreen(previewing, true);
  }

  /** While the cursor is in a `screen name:` block, the game shows that screen, redrawn as it's edited. */
  function previewAt(line: number): void {
    const lines = doc().text.split('\n');
    let name: string | null = null;
    for (let i = line - 1; i >= 0; i--) {
      const l = lines[i] ?? '';
      if (!l.trim() || /^\s/.test(l)) continue;
      name = /^screen\s+([A-Za-z_]\w*)/.exec(l)?.[1] ?? null;
      break;
    }
    if (name === previewing) return;
    previewing = name;
    player?.previewScreen(name);
  }

  function startPlayer(s: CompiledStory): void {
    player?.destroy();
    player = new Player(playerHost, s, {
      plugins,
      onUpdate: (block) => {
        playing = block && 'line' in block ? { line: block.line, ...(block.file ? { file: block.file } : {}) } : null;
        script.setPlayLine(playing && (playing.file ?? MAIN) === active ? playing.line : null);
        flow.setCurrent(block && 'label' in block ? block.label : null);
      },
    });
    player.boot();
  }

  function runFrom(line: number): void {
    flush();
    if (!player) return;
    player.jumpToLine(line, undefined, active === MAIN ? undefined : active);
    // Leave the keyboard with the script, so writing can carry on straight away.
  }

  // ---------------------------------------------------------------- script ↔ flowchart

  function labelAt(line: number): string | null {
    const zero = line - 1;
    const hit = script.analysis.ownSymbols().find((s) => s.kind === 'label' && zero >= s.line && zero <= s.endLine);
    return hit?.name ?? null;
  }

  function revealLabel(label: string): void {
    const sym = script.analysis.symbols().find((s) => s.kind === 'label' && s.name === label);
    if (sym) openSymbol(sym);
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
    if (e.key === 's') { e.preventDefault(); for (const d of docs.values()) void d.sync.saveNow(); }
    // Undo/redo the script from anywhere that isn't a text field (e.g. right after a flowchart edit).
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (!typing && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) script.redo(); else script.undo(); }
    if (!typing && e.key === 'y') { e.preventDefault(); script.redo(); }
  });

  window.addEventListener('beforeunload', (e) => {
    if ([...docs.values()].some((d) => d.sync.dirty)) e.preventDefault();
  });

  import.meta.hot?.on('emaki:story-changed', (data: { file?: string; version: string }) => void docs.get(data.file ?? MAIN)?.sync.external(data.version));
  import.meta.hot?.on('emaki:files-changed', () => void refreshFiles());
  import.meta.hot?.on('emaki:assets-changed', () => void assets.refresh());

  function showStatus(s: SaveStatus, detail?: string): void {
    const text: Record<SaveStatus, string> = {
      saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…', conflict: 'Changed in two places', error: 'Not saved',
    };
    status.textContent = text[s];
    status.dataset.status = s;
    status.title = detail ?? (s === 'saved' ? `${active} on disk matches the editor` : '');
  }

  function showConflict(theirs: StoryText): void {
    const banner = $('.conflict');
    banner.hidden = false;
    const done = () => { banner.hidden = true; };
    const d = doc();
    $('#conflict-file').textContent = d.path;
    $('#keep-mine').onclick = () => { done(); void d.sync.keepMine(); };
    $('#take-theirs').onclick = () => { done(); d.sync.takeTheirs(); };
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

/** Copy files into the game's assets folder. Files that aren't images or audio are reported, the rest still added. */
async function upload(files: File[]): Promise<AssetInfo[]> {
  const added: AssetInfo[] = [];
  const problems: string[] = [];
  for (const f of files) {
    const res = await fetch(`/__emaki/assets?name=${encodeURIComponent(f.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: f,
    });
    const body = (await res.json()) as AssetInfo & { error?: string };
    if (res.ok) added.push(body);
    else problems.push(body.error ?? `${f.name}: upload failed (${res.status})`);
  }
  if (problems.length) throw new Error(problems.join(' '));
  return added;
}

/** Flowchart / Assets tabs under the game. */
function setupTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabs [role=tab]')];
  const select = (tab: HTMLButtonElement, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')!)!.hidden = !on;
    }
    if (focus) tab.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') select(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!, true);
    });
  });
}

/** Every file of the story, story.vn first. */
async function loadFiles(): Promise<Map<string, StoryText> | null> {
  try {
    const list = await fetch('/__emaki/files');
    if (!list.ok) throw new Error(`${list.status}`);
    const { files } = (await list.json()) as { files: string[] };
    const out = new Map<string, StoryText>();
    for (const path of files) {
      const res = await fetch(`/__emaki/story?file=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      out.set(path, (await res.json()) as StoryText);
    }
    return out;
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
