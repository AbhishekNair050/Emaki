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
import {
  buildGraph, compileFiles, createCompileCache, voiceMap,
  type CompiledStory, type Diagnostic, type LabelDef, type Program, type Stmt, type StoryGraph, type Value,
} from '@emaki/format';
import { Runner, type Route, type RouteSearch } from '@emaki/runtime';
import {
  addScene, connectScenes, declareAsset, deleteScene, dropAsset, editLine, inspectLine, renameScene, type EditResult, type SceneContext, type StorySymbol,
} from '@emaki/language';
import { Player } from '@emaki/player-web';
import '@emaki/player-web/style.css';
import '@emaki/player-web/fonts';
// The game's own theme.css, after the player's styles, as in the game.
import 'virtual:emaki-theme';
import { manifests as pluginManifests, plugins } from 'virtual:emaki-plugins';
import { AssetPanel, type AssetInfo } from './assets.ts';
import { Dock, type DockEnding, type DockScene } from './dock.ts';
import { Flowchart, type Colouring, type Measure } from './flowchart.ts';
import { Inspector, type SceneCard } from './inspector.ts';
import { sceneStats, type SceneStats } from './scene-stats.ts';
import { StageTools, type StageChange } from './stage-tools.ts';
import { Timeline } from './timeline.ts';
import { ScriptPane } from './script/script-pane.ts';
import { StorySync, type SaveStatus, type StoryText } from './sync.ts';
import './editor.css';

const COMPILE_DELAY_MS = 250;
/** How long typing pauses before the text is handed to saving (see edited()). */
const TEXT_DELAY_MS = 150;
const MAIN = 'story.vn';

/** One file of the story, as the editor holds it. */
interface Doc {
  path: string;
  text: string;
  sync: StorySync;
}
const SPLIT_KEY = 'emaki-editor:script-width';
const WORKSPACE_KEY = 'emaki-editor:workspace';
const INSPECTOR_KEY = 'emaki-editor:inspector';
const ROUTE_KEY = 'emaki-editor:route';
/** How long typing pauses before the panels (inspector, timeline) catch up with the cursor's line. */
const PANELS_TYPING_DELAY_MS = 300;
/** How long the cursor rests before the inspector is drawn again (a held arrow key moves it every 30 ms). */
const INSPECTOR_REST_MS = 90;
const WORKSPACES = ['write', 'stage', 'story'] as const;
type Workspace = typeof WORKSPACES[number];
/** How long the cursor rests on a line before the Stage workspace's game shows it. */
const FOLLOW_DELAY_MS = 220;
/** How long the route search may play the story, and how long after an edit it starts again. */
const ROUTE_BUDGET_MS = 4000;
const ROUTE_DELAY_MS = 1200;

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
  let playing: { line: number; file?: string; label?: string } | null = null;
  /** The timeline shows the scene that moved last: the cursor's, or the game's as it plays on. */
  let timelineFollowsGame = false;
  let compileTimer = 0;
  /** Colouring the flowchart by what's been read waits for this, so playing doesn't recolour every line. */
  let recolourTimer = 0;

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
    measure: (by) => measureScenes(by),
    variables: () => Object.keys(story?.vars ?? {}),
  });

  // The left dock: every scene, and the route the editor plays by (D-065). Its second tab holds the assets.
  const dock = new Dock($('.dock-host'), {
    reveal: (label) => revealLabel(label),
    pickRoute: (id) => chooseRoute(id),
    searchAgain: () => searchRoutes(true),
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

  const assets = new AssetPanel(dock.assetsHost, {
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
  /** Each declared file's name, by kind and path: made once per parse (thousands of files ask for theirs). */
  let declaredFor: Program | null = null;
  let declared = new Map<string, string>();
  function declaredIn(a: AssetInfo): string | undefined {
    const p = script.analysis.program;
    if (declaredFor !== p) {
      declaredFor = p;
      declared = new Map();
      const add = (kind: string, path: string, name: string) => {
        const key = `${kind}:${path.replace(/^\.?\//, '')}`;
        // The first declaration of a file is the one a search would have found.
        if (!declared.has(key)) declared.set(key, name);
      };
      for (const d of p.images) add('image', d.path, d.name);
      for (const d of p.audio) add('audio', d.path, d.name);
    }
    return declared.get(`${a.kind}:${a.path}`);
  }

  const addDoc = (path: string, text: StoryText): Doc => {
    const d: Doc = {
      path,
      text: text.text,
      sync: new StorySync(text, {
        status: (s, detail) => {
          if (path === active) showStatus(s, detail);
          // Every keystroke reports 'unsaved': redraw the file list (hundreds of files in a long game) only on a change.
          if (statuses.get(path) === s) return;
          statuses.set(path, s);
          updateFileList();
        },
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
  // Compiles (the game's and the script pane's) redo only the files and labels that changed.
  const compileCache = createCompileCache();
  const script = new ScriptPane($('.cm-host'), initial.text, {
    onChange: () => { edited(); scheduleCompile(); },
    onRun: (line) => runFrom(line),
    onCursor: (line, typing) => { timelineFollowsGame = false; cursorMoved(line, typing); },
    onSave: () => { syncText(); void doc().sync.saveNow(); },
    onDrop: (drop, line) => void dropOnScript(drop, line),
    context: () => ({
      file: active,
      files: docs.size > 1 ? [...docs.values()].map((d) => ({ path: d.path, source: d.text })) : [],
      plugins: pluginManifests,
      cache: compileCache,
    }),
    openDefinition: (sym) => openSymbol(sym),
  }, MAIN);

  /**
   * Typing marks the file unsaved at once, but copies the text out of the editor (the whole file, megabytes in a
   * long game) only when typing pauses, or before anything needs it: saving, compiling, switching files.
   */
  let textTimer = 0;
  function edited(): void {
    if (!textTimer && statuses.get(active) !== 'unsaved') showStatus('unsaved');
    window.clearTimeout(textTimer);
    textTimer = window.setTimeout(syncText, TEXT_DELAY_MS);
  }
  function syncText(): void {
    if (!textTimer) return;
    window.clearTimeout(textTimer);
    textTimer = 0;
    const text = script.text;
    doc().text = text;
    doc().sync.changed(text);
  }

  /** Show another file of the story in the script pane. */
  function openFile(path: string): void {
    if (!docs.has(path) || path === active) return;
    syncText();
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
    syncText();
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

  // ---------------------------------------------------------------- workspaces, inspector, timeline, routes (D-065)

  const inspector = new Inspector($('.inspector-host'), {
    change: (line, change) => {
      const r = editLine(script.lineText(line), change);
      if (!r.ok) return r.error;
      script.replaceLine(line, r.text);
      // Show the change straight away: a reload keeps the picture the game already drew.
      if (workspace !== 'write') runFrom(line);
      return null;
    },
    openOnStage: (label) => { setWorkspace('stage'); revealLabel(label); },
    openInScript: (label) => { setWorkspace('write'); revealLabel(label); },
    hide: () => showInspector(false),
  });
  /** The inspector can be hidden, giving its width to the middle; hidden, it isn't drawn at all. */
  let inspectorShown = true;
  try { inspectorShown = localStorage.getItem(INSPECTOR_KEY) !== 'hidden'; } catch { /* storage unavailable */ }
  const inspectorButton = $<HTMLButtonElement>('#toggle-inspector');
  function showInspector(on: boolean): void {
    inspectorShown = on;
    document.body.classList.toggle('inspector-hidden', !on);
    inspectorButton.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem(INSPECTOR_KEY, on ? 'shown' : 'hidden'); } catch { /* storage unavailable */ }
    if (on) {
      // Draw it for where the cursor is now.
      storyCardLabel = undefined;
      inspectedLine = 0;
      panelsStale = true;
      cursorMoved(script.cursorLine, false, true);
    }
  }
  inspectorButton.addEventListener('click', () => showInspector(!inspectorShown));
  document.body.classList.toggle('inspector-hidden', !inspectorShown);
  inspectorButton.setAttribute('aria-pressed', String(inspectorShown));
  const timeline = new Timeline($('.timeline-host'), {
    go: (line, file) => {
      if ((file ?? MAIN) !== active) openFile(file ?? MAIN);
      script.revealLine(line);
    },
    colorOf: (who) => story?.characters[who]?.color ?? null,
    nameOf: (tag) => story?.characters[tag]?.name ?? tag,
  });

  // In Stage, a character can be picked and moved, sized or turned: the `show` line that put them there changes.
  const stageTools = new StageTools(playerHost, $('.stage-toolbar'), {
    enabled: () => workspace === 'stage',
    pose: (tag) => {
      const pose = timeline.pose(tag);
      const shown = showLineOf(tag);
      const props = shown ? inspectLine(shown.text)?.stmt : null;
      const p = props?.type === 'show' ? props.props : undefined;
      return { text: pose ? [pose.look, pose.at].filter(Boolean).join(' · ') : '', zoom: p?.zoom?.[0] ?? 1, rotate: p?.rotate ?? 0 };
    },
    changed: (tag, change) => restage(tag, change),
  });
  /** The `show` that put a character on stage: the nearest one above the game's line, in the same scene. */
  function showLineOf(tag: string): { n: number; text: string } | null {
    if (!playing || (playing.file ?? MAIN) !== active) return null;
    for (let n = playing.line; n >= 1; n--) {
      const text = script.lineText(n);
      if (/^\S/.test(text) && !text.startsWith('#')) break;
      const found = inspectLine(text);
      if (found?.stmt.type === 'show' && (found.stmt.tag === tag || found.stmt.as === tag)) return { n, text };
    }
    return null;
  }
  function restage(tag: string, change: StageChange): string {
    if (!playing) return 'Play the scene first.';
    if ((playing.file ?? MAIN) !== active) openFile(playing.file ?? MAIN);
    const shown = showLineOf(tag);
    if (!shown) return `No “show ${tag}” in this scene above line ${playing.line} to change.`;
    const r = editLine(shown.text, change);
    if (!r.ok) return r.error;
    script.replaceLine(shown.n, r.text);
    flush();
    player?.jumpToLine(playing.line, undefined, playing.file);
    const what = 'at' in change ? `at ${change.at}` : 'zoom' in change ? `zoom ${change.zoom}` : `rotate ${change.rotate}°`;
    return `${tag} ${what} · line ${shown.n}`;
  }

  /** Words, lines, choices and what each scene sets, worked out once per compiled story and only when asked. */
  let statsFor: CompiledStory | null = null;
  let stats = new Map<string, SceneStats>();
  const statsOf = (): Map<string, SceneStats> => {
    if (story && statsFor !== story) { stats = sceneStats(story); statsFor = story; }
    return stats;
  };
  const readShare = (s: SceneStats): number => s.ids.length ? s.ids.filter((id) => player!.hasRead(id)).length / s.ids.length : 0;
  /** A variable's values entering a scene, as found by the route search: `0 to 2`, `true`, `true or false`. */
  const rangeText = (values: Value[] | undefined): string => {
    if (!values?.length) return 'not reached';
    if (values.every((v) => typeof v === 'number')) {
      const nums = values as number[];
      const lo = Math.min(...nums), hi = Math.max(...nums);
      return lo === hi ? String(lo) : `${lo} to ${hi}`;
    }
    return values.map((v) => JSON.stringify(v).replace(/^"|"$/g, '')).join(' or ');
  };
  function measureScenes(by: Colouring): Map<string, Measure> | null {
    if (!story) return null;
    const all = statsOf();
    const out = new Map<string, Measure>();
    if (by === 'read') {
      if (!player) return null;
      for (const [label, s] of all) {
        const share = readShare(s);
        out.set(label, { level: share >= 1 ? 4 : share > 0 ? Math.max(1, Math.ceil(share * 3)) : 0, text: `${Math.round(share * 100)}% of lines seen` });
      }
      return out;
    }
    if (by === 'words') {
      // By rank, so one very long scene doesn't make every other one look empty.
      const sorted = [...all].sort((a, b) => a[1].words - b[1].words);
      sorted.forEach(([label, s], i) => out.set(label, { level: Math.round((sorted.length > 1 ? i / (sorted.length - 1) : 1) * 4), text: `${s.words} words` }));
      return out;
    }
    // A variable's value as each scene begins, from the route search.
    const name = by.slice(4);
    const entries = routeResult?.entries ?? {};
    let max = 0;
    for (const vars of Object.values(entries)) for (const v of vars[name] ?? []) if (typeof v === 'number') max = Math.max(max, Math.abs(v));
    for (const label of Object.keys(story.labels)) {
      const values = entries[label]?.[name];
      if (!values?.length) { out.set(label, { level: 0, text: `${name} not reached` }); continue; }
      const level = values.every((v) => typeof v === 'number')
        ? Math.round((Math.max(...(values as number[]).map(Math.abs)) / (max || 1)) * 4)
        : values.every((v) => v === true) ? 4 : values.some((v) => v === true) ? 2 : 0;
      out.set(label, { level, text: `${name} ${rangeText(values)}` });
    }
    return out;
  }

  // ---- routes: searched in a worker after each edit; the chosen one sets the variables everywhere

  let lastGraph: StoryGraph | null = null;
  let routeResult: RouteSearch | null = null;
  let chosenRoute: string | null = null;
  try { chosenRoute = localStorage.getItem(ROUTE_KEY); } catch { /* storage unavailable */ }
  const chosen = (): Route | null => routeResult?.routes.find((r) => r.ending === chosenRoute) ?? null;
  /** An ending's name: as declared (`ending id "Name"`), or the achievement its scene unlocks, or its scene. */
  let achievedIn: { for: CompiledStory; names: Map<string, string> } | null = null;
  const endingName = (id: string): string => {
    if (story?.endings?.[id]) return story.endings[id]!.name;
    if (story && achievedIn?.for !== story) {
      const names = new Map<string, string>();
      for (const ins of story.code) if (ins.op === 'achieve' && !names.has(ins.src.label)) names.set(ins.src.label, story.achievements?.[ins.id]?.name ?? ins.id);
      achievedIn = { for: story, names };
    }
    return achievedIn?.names.get(id) ?? id;
  };
  function chooseRoute(id: string | null): void {
    chosenRoute = id;
    try { if (id) localStorage.setItem(ROUTE_KEY, id); else localStorage.removeItem(ROUTE_KEY); } catch { /* storage unavailable */ }
    showRoute();
    panelsStale = true;
    cursorMoved(script.cursorLine, false, true);
  }
  function showRoute(): void {
    const r = chosen();
    const scenes = r ? r.scenes.map((s) => s.label) : null;
    flow.setRoute(scenes);
    dock.setRoute(scenes);
    renderEndings();
  }
  function renderEndings(): void {
    if (!story || !lastGraph) return;
    const r = routeResult;
    const declared = Object.keys(story.endings ?? {});
    const graphEndings = lastGraph.nodes.filter((n) => n.ending).map((n) => n.label);
    const found = new Map((r?.routes ?? []).map((x) => [x.ending, x]));
    const ids = [...new Set([...(declared.length ? declared : graphEndings), ...found.keys()])];
    const list: DockEnding[] = ids.map((id) => {
      const route = found.get(id);
      const last = route?.scenes.at(-1)?.label ?? id;
      const ways = [...new Set(lastGraph!.edges.filter((e) => e.to === last && e.via).map((e) => e.via!))];
      const choices = route ? `${route.choices.length} ${route.choices.length === 1 ? 'choice' : 'choices'}` : '';
      return {
        id,
        title: endingName(id),
        detail: ways.length ? ways.join(' / ') : choices || 'reached',
        found: !!route,
        missing: !r ? 'searching…' : r.complete ? 'never reached' : 'not found yet',
      };
    });
    const reached = list.filter((e) => e.found).length;
    const status = !r ? 'Searching for routes…'
      : `${reached} of ${list.length} reached${r.complete ? '' : ' so far (the search stopped after its time)'} · ${r.states} choice ${r.states === 1 ? 'point' : 'points'} in ${r.ms < 1000 ? `${r.ms} ms` : `${(r.ms / 1000).toFixed(1)} s`}`;
    dock.setEndings(list, chosen() ? chosenRoute : null, status);
  }
  /**
   * The variables at each line of a scene on the chosen route: the scene is played with the real runner from the
   * route's values, making the route's choices, so a line after a choice sees what that choice set. Worked out
   * once per scene, route and compiled story.
   */
  let lineVars: { key: string; lines: { line: number; file?: string; vars: Record<string, Value> }[] } | null = null;
  function routeVarsAtLine(line: number, label: string | null, file?: string): Record<string, Value> | undefined {
    const route = chosen();
    const i = route && label ? route.scenes.findIndex((s) => s.label === label) : -1;
    if (!route || !story || !label || i < 0) return undefined;
    const key = `${route.ending}|${label}`;
    if (lineVars?.key !== key || linesFor !== story) {
      linesFor = story;
      const scene = route.scenes[i]!;
      const choices = route.choices.slice(scene.choicesBefore, route.scenes[i + 1]?.choicesBefore ?? route.choices.length);
      const lines: { line: number; file?: string; vars: Record<string, Value> }[] = [];
      try {
        const runner = new Runner(story);
        let step = runner.startAt(label, { vars: scene.vars });
        let next = 0;
        for (let n = 0; n < 20_000; n++) {
          const b = step.block;
          if (b.type === 'end' || !('label' in b) || b.label !== label) break;
          lines.push({ line: b.line, ...(b.file ? { file: b.file } : {}), vars: { ...runner.vars } });
          if (b.type === 'menu') {
            const want = choices[next++];
            const option = want && b.choices.find((c) => c.text === want.text);
            if (!option) break;
            step = runner.choose(option.index);
          } else if (b.type === 'say' || b.type === 'wait') step = runner.advance();
          else break;
        }
      } catch { /* a line the runner can't play here (a plugin's question): stop there */ }
      lineVars = { key, lines };
    }
    // The values at the last line shown at or before this one (a line's own `set`s come after it shows).
    let best: Record<string, Value> = route.scenes[i]!.vars;
    for (const l of lineVars.lines) if ((l.file ?? undefined) === (file ?? undefined) && l.line <= line) best = l.vars;
    return best;
  }
  let linesFor: CompiledStory | null = null;

  let routeWorker: Worker | null = null;
  let routeRequest = 0;
  let routeBusy = false;
  let searchedStory: CompiledStory | null = null;
  let routeTimer = 0;
  function searchRoutes(force = false): void {
    window.clearTimeout(routeTimer);
    if (!story || (!force && searchedStory === story)) return;
    searchedStory = story;
    // A search of an older version is no use any more.
    if (routeWorker && routeBusy) { routeWorker.terminate(); routeWorker = null; }
    if (!routeWorker) {
      routeWorker = new Worker(new URL('./routes-worker.ts', import.meta.url), { type: 'module' });
      routeWorker.onmessage = (e: MessageEvent<{ id: number; result: RouteSearch }>) => {
        if (e.data.id !== routeRequest) return;
        routeBusy = false;
        routeResult = e.data.result;
        showRoute();
        flow.recolourIfVariable();
        panelsStale = true;
        cursorMoved(script.cursorLine, false, true);
      };
      routeWorker.onerror = (e) => { routeBusy = false; console.error(e); flashNote('The route search stopped with an error.'); };
    }
    routeBusy = true;
    dock.setSearching();
    // The worker compiles the text itself: copying text to it is cheap, a long game's compiled code isn't.
    syncText();
    const parts = [...docs.values()].filter((d) => d.path !== MAIN).map((d) => ({ path: d.path, source: d.text }));
    routeWorker.postMessage({ id: ++routeRequest, main: doc(MAIN).text, parts, plugins: pluginManifests, budgetMs: ROUTE_BUDGET_MS });
  }

  /** The scene card (Story workspace): what the scene holds, what it can expect, and what the route does there. */
  function sceneCard(label: string): SceneCard {
    const s = statsOf().get(label);
    const def = labelNamed(label);
    const entry = routeResult?.entries[label] ?? {};
    // The variables worth showing: the one the chart is coloured by first, then the rest, three at most.
    const names = Object.keys(story?.vars ?? {});
    const facts: [string, string][] = [['Words', String(s?.words ?? 0)], ['Lines', String(s?.lines ?? 0)]];
    for (const name of names.slice(0, 3)) facts.push([`${name} on entry`, routeResult ? rangeText(entry[name]) : '…']);
    facts.push(['Seen in playtests', player && s ? `${Math.round(readShare(s) * 100)}%` : '—']);
    facts.push(['Sets', s?.sets.length ? s.sets.join(', ') : 'nothing']);
    const route = chosen();
    let routeChoice: string | null = null;
    if (route) {
      const i = route.scenes.findIndex((x) => x.label === label);
      if (i >= 0) {
        const end = route.scenes[i + 1]?.choicesBefore ?? route.choices.length;
        routeChoice = route.choices.slice(route.scenes[i]!.choicesBefore, end).map((c) => c.text).join('” then “') || null;
      }
    }
    return { label, file: def?.loc.file ?? MAIN, line: def?.loc.line ?? 0, picture: s?.picture ?? null, facts, routeChoice, routeName: route ? endingName(route.ending) : null };
  }

  /** The program of the last compile, and its scenes by name (made when first needed). */
  let lastProgram: Program | null = null;
  let labelsByName: Map<string, LabelDef> | null = null;
  const labelNamed = (name: string): LabelDef | null => {
    if (!lastProgram) return null;
    labelsByName ??= new Map(lastProgram.labels.map((l) => [l.name, l]));
    return labelsByName.get(name) ?? null;
  };

  let workspace: Workspace = 'write';
  setupSplitter();
  function setWorkspace(ws: Workspace): void {
    workspace = ws;
    document.body.dataset.workspace = ws;
    for (const b of document.querySelectorAll<HTMLButtonElement>('.workspaces [data-workspace]')) b.setAttribute('aria-pressed', String(b.dataset.workspace === ws));
    try { localStorage.setItem(WORKSPACE_KEY, ws); } catch { /* storage unavailable */ }
    // The panels catch up with where the cursor is.
    panelsStale = true;
    cursorMoved(script.cursorLine, false, true);
    if (ws === 'story') {
      searchRoutes();
      requestAnimationFrame(() => flow.showCursor());
    }
    // Stage shows the moment the cursor is on.
    if (ws === 'stage') {
      if (player && script.lineText(script.cursorLine).trim() && playing?.line !== script.cursorLine) runFrom(script.cursorLine);
      stageTools.follow();
    }
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('.workspaces [data-workspace]')) {
    b.addEventListener('click', () => setWorkspace(b.dataset.workspace as Workspace));
  }

  /** Where the cursor is, for every panel. */
  let cursorLabel: string | null | undefined;
  let cursorLineNo = 0;
  let followTimer = 0;
  let panelFrame = 0;
  let panelTimer = 0;
  /** The story or the route changed: every panel draws again. */
  let panelsStale = true;
  const position = $('.position');
  function cursorMoved(line: number, typing: boolean, now = false): void {
    const label = labelAt(line);
    const lineChanged = line !== cursorLineNo;
    cursorLineNo = line;
    // The scene's panels (flowchart, dock) follow in the panel pass below: changing them here, inside the
    // editor's own update, would make the browser lay the page out again before the cursor is even drawn.
    cursorLabel = label;
    previewAt(line);
    // The panels are drawn once per frame at most; while typing, when it pauses.
    window.clearTimeout(panelTimer);
    if (now) {
      cancelAnimationFrame(panelFrame);
      panelFrame = 0;
      updatePanels();
    } else if (typing && !lineChanged) {
      panelTimer = window.setTimeout(updatePanels, PANELS_TYPING_DELAY_MS);
    } else if (!panelFrame) panelFrame = requestAnimationFrame(() => { panelFrame = 0; updatePanels(); });
    // In Stage, the game shows the line the cursor rests on (not while typing: that would restart the line).
    if (workspace === 'stage' && lineChanged && !typing) {
      window.clearTimeout(followTimer);
      followTimer = window.setTimeout(() => {
        if (script.cursorLine === line && script.lineText(line).trim()) runFrom(line);
      }, FOLLOW_DELAY_MS);
    }
  }
  function updatePosition(line: number, label: string | null): void {
    const b = (text: string, cls = '') => Object.assign(document.createElement('b'), { textContent: text, className: cls });
    // Each piece its own element: text side by side would run together in the pill's flex row.
    const span = (text: string) => Object.assign(document.createElement('span'), { textContent: text });
    const route = chosen();
    position.replaceChildren(
      span('Everything is showing'),
      ...(docs.size > 1 && active !== MAIN ? [b(active)] : []),
      ...(label ? [b(label)] : []),
      span(`line ${line}`),
      ...(route ? [span('· route'), b(endingName(route.ending), 'route')] : []),
    );
  }
  let storyCardLabel: string | null | undefined;
  /** The scene the flowchart and the dock last marked. */
  let panelLabel: string | null | undefined;
  function updatePanels(): void {
    const line = script.cursorLine;
    const label = cursorLabel ?? null;
    const stale = panelsStale;
    panelsStale = false;
    if (label !== panelLabel) {
      panelLabel = label;
      flow.setCursor(label, workspace === 'story');
      dock.setCursor(label);
    }
    updatePosition(line, label);
    syncTimeline(stale);
    if (!inspectorShown) return;
    if (workspace === 'story') {
      if (storyCardLabel !== label || stale) {
        storyCardLabel = label;
        inspector.showScene(label ? sceneCard(label) : null);
      }
      return;
    }
    storyCardLabel = undefined;
    // The inspector is the heaviest panel: while the cursor keeps moving, it waits for it to rest.
    window.clearTimeout(inspectorTimer);
    if (stale || line === inspectedLine) drawInspector(line, label);
    else inspectorTimer = window.setTimeout(() => drawInspector(script.cursorLine, cursorLabel ?? null), INSPECTOR_REST_MS);
  }
  let inspectorTimer = 0;
  let inspectedLine = 0;
  function drawInspector(line: number, label: string | null): void {
    inspectedLine = line;
    const text = script.lineText(line);
    inspector.showLine(line, text, `${active}${label ? ` · ${label}` : ''}`);
    showVars(label);
    if (workspace === 'stage') {
      // The character the line is about is the one picked on the stage.
      const found = inspectLine(text)?.stmt;
      const tag = found?.type === 'show' || found?.type === 'hide' ? found.tag : found?.type === 'say' ? found.who : null;
      if (tag) stageTools.select(tag);
    }
  }
  /** The inspector's variables: the game's own in Stage (it is at this line), else the route's as the scene begins. */
  function showVars(label: string | null): void {
    const route = chosen();
    const names = Object.keys(story?.vars ?? {});
    const show = (vars: Readonly<Record<string, Value>>) => names.map((k): [string, string] => [k, JSON.stringify(vars[k] ?? null)]);
    if (workspace === 'stage' && player) {
      inspector.setVars(route ? `Variables here on the route to ${endingName(route.ending)}` : 'Variables here, in the game', show(player.vars));
      return;
    }
    const vars = routeVarsAtLine(script.cursorLine, label, active === MAIN ? undefined : active);
    if (route && vars) { inspector.setVars(`Variables here on the route to ${endingName(route.ending)}`, show(vars)); return; }
    // No route through here: what the scene can expect, over every way the search found to it.
    const entry = label ? routeResult?.entries[label] : undefined;
    inspector.setVars(route ? 'Variables entering this scene (it isn’t on the chosen route)' : 'Variables entering this scene, every way', entry ? names.map((k): [string, string] => [k, rangeText(entry[k])]) : null);
  }
  /** The story was recompiled: the timeline redraws when next shown. */
  let timelineStale = true;
  /**
   * The timeline shows the cursor's scene, or the game's when it was the last to move, and marks both lines in it
   * (the cursor's, and the game's as the script marks it).
   */
  function syncTimeline(stale = false): void {
    const cursorScene = cursorLabel ?? null;
    const label = timelineFollowsGame && playing?.label ? playing.label : cursorScene;
    if (timeline.scene !== label || stale || timelineStale) {
      timelineStale = false;
      const def = label ? labelNamed(label) : null;
      timeline.setScene(def, def?.loc.file);
    }
    const sameFile = (file: string | undefined) => (file ?? MAIN) === (timeline.sceneFile ?? MAIN);
    timeline.setCursor(label === cursorScene && sameFile(active === MAIN ? undefined : active) ? script.cursorLine : null);
    timeline.setPlaying(playing && playing.label === label && sameFile(playing.file) ? playing.line : null, timelineFollowsGame);
  }

  /** The dock's list: every scene, the start and the endings marked. */
  function sceneList(): DockScene[] {
    const startLabel = story ? Object.entries(story.labels).find(([, pc]) => pc === story!.start)?.[0] : undefined;
    return (lastGraph?.nodes ?? []).map((n) => ({ label: n.label, kind: n.label === startLabel ? 'start' : n.ending ? 'ending' : 'scene' }));
  }

  let saved: string | null = null;
  try { saved = localStorage.getItem(WORKSPACE_KEY); } catch { /* storage unavailable */ }
  recompile();
  updateFileList();
  script.revealLine(1, true, false);
  // The launcher can open the editor straight into a workspace (`?workspace=story`); otherwise the last one used.
  const asked = new URLSearchParams(location.search).get('workspace');
  if (asked) history.replaceState(null, '', location.pathname + location.hash);
  const first = [asked, saved].find((w): w is Workspace => WORKSPACES.includes(w as Workspace)) ?? 'write';
  setWorkspace(first);
  void assets.refresh();

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
    syncText();
    doc().text = script.text;
    const parts = [...docs.values()].filter((d) => d.path !== MAIN).map((d) => ({ path: d.path, source: d.text }));
    const r = compileFiles(doc(MAIN).text, parts, { plugins: pluginManifests, cache: compileCache });
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

    // The timeline reads the parsed scenes, which are there even while another part of the script has an error.
    lastProgram = r.program;
    labelsByName = null;
    timelineStale = true;
    if (!r.story) {
      cursorMoved(script.cursorLine, true);
      gameNote.textContent = story ? 'The script has errors: the game is running the last version that worked.' : 'Fix the errors in the script to start the game.';
      return;
    }
    gameNote.textContent = '';
    story = r.story;
    inspector.setCatalog({ images: story.images, characters: story.characters });
    // A voiced game's lines play their files here too (the files the assets folder has).
    const voices = voiceMap(story, (path) => assetPaths.has(path));
    if (Object.keys(voices).length) story.voices = voices;
    document.title = `${story.meta.title ?? 'Untitled'} · Emaki editor`;
    $('.story-title').textContent = story.meta.title ?? 'Untitled';
    lastGraph = buildGraph(r.program);
    flow.update(story, lastGraph);
    flow.refreshVariables();
    flow.recolour();
    dock.setScenes(sceneList());
    renderEndings();
    panelsStale = true;
    cursorMoved(script.cursorLine, true);
    // In Story, the routes are searched again once the edits settle (in a worker); elsewhere the last search
    // stands until Story is opened or "Search again" is pressed, so writing never shares the computer with it.
    window.clearTimeout(routeTimer);
    if (workspace === 'story' || !searchedStory) routeTimer = window.setTimeout(() => searchRoutes(), searchedStory ? ROUTE_DELAY_MS : 0);
    assets.scriptChanged();
    if (!player) startPlayer(story);
    else if (!player.reload(story)) flashNote('Couldn’t find the line the game was on after that edit, so it went back to the title screen.');
    if (previewing) player?.previewScreen(previewing, true);
  }

  /** While the cursor is in a `screen name:` block, the game shows that screen, redrawn as it's edited. */
  function previewAt(line: number): void {
    const top = topLevelAbove(line);
    const name = top === null ? null : /^screen\s+([A-Za-z_]\w*)/.exec(top)?.[1] ?? null;
    if (name === previewing) return;
    previewing = name;
    player?.previewScreen(name);
  }

  function startPlayer(s: CompiledStory): void {
    player?.destroy();
    player = new Player(playerHost, s, {
      plugins,
      onUpdate: (block) => {
        const was = playing;
        const label = block && 'label' in block ? block.label : undefined;
        playing = block && 'line' in block ? { line: block.line, ...(block.file ? { file: block.file } : {}), ...(label ? { label } : {}) } : null;
        script.setPlayLine(playing && (playing.file ?? MAIN) === active ? playing.line : null);
        flow.setCurrent(label ?? null);
        // The game moved on: the timeline follows it (and goes back to the cursor's scene when the cursor moves).
        if (playing && (playing.line !== was?.line || playing.file !== was?.file)) {
          timelineFollowsGame = true;
          syncTimeline();
        } else if (!playing) syncTimeline();
        // Colouring by what's been read follows the playtest, a few times a second at most.
        if (!recolourTimer) recolourTimer = window.setTimeout(() => { recolourTimer = 0; flow.recolourIfRead(); }, 1500);
        if (workspace === 'stage') {
          stageTools.follow();
          if (inspectorShown) showVars(cursorLabel ?? null);
        }
      },
    });
    player.boot();
  }

  function runFrom(line: number): void {
    flush();
    if (!player) return;
    // The chosen route's variables, when it passes through the line's scene.
    player.jumpToLine(line, routeVarsAtLine(line, labelAt(line), active === MAIN ? undefined : active), active === MAIN ? undefined : active);
    // Leave the keyboard with the script, so writing can carry on straight away.
  }

  // ---------------------------------------------------------------- script ↔ flowchart

  /**
   * The nearest line above `line` (1-based, itself included) that starts at the margin, skipping blank lines and
   * comments. Runs on every cursor move, so it walks the editor's own lines up from the cursor: it never copies
   * or splits the file, which in a long script costs more than the move itself.
   */
  function topLevelAbove(line: number): string | null {
    const lines = script.view.state.doc;
    for (let i = Math.min(line, lines.lines); i >= 1; i--) {
      const l = lines.line(i).text;
      if (!l.trim() || /^\s/.test(l) || l.startsWith('#')) continue;
      return l;
    }
    return null;
  }

  /** The label the cursor is in: the nearest `label` line above it. */
  function labelAt(line: number): string | null {
    const top = topLevelAbove(line);
    return top === null ? null : /^label\s+([A-Za-z_]\w*)\s*:/.exec(top)?.[1] ?? null;
  }

  function revealLabel(label: string): void {
    const sym = script.analysis.symbols().find((s) => s.kind === 'label' && s.name === label);
    if (sym) openSymbol(sym);
  }

  // ---------------------------------------------------------------- top bar

  $('#run').addEventListener('click', () => runFrom(script.cursorLine));
  const stepLine = (d: -1 | 1) => {
    const line = timeline.neighbour(d);
    if (line === null) return;
    if ((timeline.sceneFile ?? MAIN) !== active) openFile(timeline.sceneFile ?? MAIN);
    script.revealLine(line, true, false);
  };
  $('#prev-line').addEventListener('click', () => stepLine(-1));
  $('#next-line').addEventListener('click', () => stepLine(1));
  $('#restart').addEventListener('click', () => { flush(); if (story) startPlayer(story); });
  problemsBtn.addEventListener('click', () => script.showProblems());
  $('#format').addEventListener('click', () => {
    if (!script.format()) flashNote('Fix the errors first: formatting never touches a script that doesn’t parse.');
  });

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && ['1', '2', '3'].includes(e.key)) {
      e.preventDefault();
      setWorkspace(WORKSPACES[Number(e.key) - 1]!);
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyI') {
      e.preventDefault();
      showInspector(!inspectorShown);
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'Enter') { e.preventDefault(); runFrom(script.cursorLine); }
    if (e.key === 's') { e.preventDefault(); syncText(); for (const d of docs.values()) void d.sync.saveNow(); }
    // Undo/redo the script from anywhere that isn't a text field (e.g. right after a flowchart edit).
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (!typing && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) script.redo(); else script.undo(); }
    if (!typing && e.key === 'y') { e.preventDefault(); script.redo(); }
  });

  window.addEventListener('beforeunload', (e) => {
    syncText();
    if ([...docs.values()].some((d) => d.sync.dirty)) e.preventDefault();
  });

  // Hand over the latest typing first, so a change on disk is never mistaken for one we can load silently.
  import.meta.hot?.on('emaki:story-changed', (data: { file?: string; version: string }) => { syncText(); void docs.get(data.file ?? MAIN)?.sync.external(data.version); });
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

/** Every file of the story, story.vn first. */
async function loadFiles(): Promise<Map<string, StoryText> | null> {
  try {
    // All of them in one request: a long game has hundreds of files.
    const list = await fetch('/__emaki/files?text=1');
    if (!list.ok) throw new Error(`${list.status}`);
    const { files, texts } = (await list.json()) as { files: string[]; texts: Record<string, StoryText> };
    return new Map(files.map((path) => [path, texts[path]!]));
  } catch (err) {
    document.body.innerHTML = '<p class="fatal">Couldn’t load story.vn from the editor server. Is <code>npm run edit</code> still running?</p>';
    console.error(err);
    return null;
  }
}

/** Drag (or arrow-key) the bar between the script and the game (Write) to share the space between them. */
function setupSplitter(): void {
  const workspace = $('.workspace');
  const bar = $('.splitter');
  const script = $('.script-pane');
  const apply = (px: number, save = true) => {
    const room = script.getBoundingClientRect().width + $('.game-pane').getBoundingClientRect().width;
    const v = Math.round(Math.min(room * 0.8, Math.max(room * 0.2, px)));
    workspace.style.setProperty('--script-w', `${v}px`);
    bar.setAttribute('aria-valuenow', String(Math.round((v / room) * 100)));
    if (save) try { localStorage.setItem(SPLIT_KEY, String(v)); } catch { /* storage unavailable */ }
  };
  let stored = NaN;
  try { stored = Number(localStorage.getItem(SPLIT_KEY)); } catch { /* storage unavailable */ }
  if (Number.isFinite(stored) && stored > 0) workspace.style.setProperty('--script-w', `${stored}px`);
  bar.setAttribute('aria-valuemin', '20');
  bar.setAttribute('aria-valuemax', '80');

  bar.addEventListener('pointerdown', (e) => {
    bar.setPointerCapture(e.pointerId);
    const left = script.getBoundingClientRect().left;
    const move = (ev: PointerEvent) => apply(ev.clientX - left);
    const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
  bar.addEventListener('keydown', (e) => {
    const now = script.getBoundingClientRect().width;
    if (e.key === 'ArrowLeft') apply(now - 40);
    if (e.key === 'ArrowRight') apply(now + 40);
  });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

void main();
