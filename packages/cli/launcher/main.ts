import type { Project } from '../src/projects.ts';
import type { Session, SessionKind } from '../src/serve.ts';
import type { ProjectInfo } from '../src/project-info.ts';
import type { Compression, Estimate } from '../src/compress.ts';

interface Job { id: number; path: string; target: string; status: 'running' | 'done' | 'failed'; log: string; output: string }
interface State { projects: Project[]; sessions: Session[]; jobs: Job[]; defaultDirectory: string; home: string; platform: string }
interface Folders { path: string; parent: string | null; folders: string[]; game: boolean; roots: string[] }
interface InfoState { working: boolean; info: ProjectInfo | null; error: string | null }
/** Present when the launcher runs inside Emaki Studio (packages/studio): the system's folder picker. */
interface StudioBridge { pickFolder(options: { title: string; defaultPath?: string }): Promise<string | null> }
const studio = (window as { emakiStudio?: StudioBridge }).emakiStudio ?? null;
if (studio) document.getElementById('running-hint')!.textContent = 'The editor and the player each open in their own window.';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const button = (id: string) => $<HTMLButtonElement>(id);
const input = (id: string) => $<HTMLInputElement>(id);
let state: State = { projects: [], sessions: [], jobs: [], defaultDirectory: '', home: '', platform: '' };
let selected = stored('emaki-launcher:selected', null, '');
let mode: 'create' | 'open' = 'create';
let folderEdited = false;
let folderTarget: 'parent' | 'existing-path' = 'parent';
let folders: Folders | null = null;
let busy = false;
let refreshing = false;
let listSignature = '';
let detailSignature = '';
let browseRequest = 0;
let connected = false;
const pending = new Set<SessionKind>();
/** Each project's info (picture, size, problems), as last fetched. */
const infos = new Map<string, InfoState>();
/** The workspace "Open editor" opens, and the platform to export to: remembered. */
let workspace = stored('emaki-launcher:workspace', ['write', 'stage', 'story'], 'write');
let target = stored('emaki-launcher:target', ['web', 'desktop', 'android', 'ios'], 'web');
const TARGET_NOTES: Record<string, string> = {
  web: 'A folder to upload to itch.io or any web host. It plays in every modern browser.',
  desktop: 'An app for this computer. Windows x64 uses WebView2 and an encrypted game pack. Steam games and other platforms use Electron.',
  android: 'An Android Studio project, and a test APK when the Android SDK is installed.',
  ios: 'An Xcode project. Building it needs a Mac with Xcode.',
};
const TARGET_NAMES: Record<string, string> = { web: 'web', desktop: 'desktop', android: 'Android', ios: 'iOS' };
type Kind = keyof Compression;
interface CompressionState { settings: Compression; missing: { audio: string | null; voice: string | null; video: string | null } }
/** The selected project's compression settings, as last loaded or saved. */
let compression: { path: string; state: CompressionState } | null = null;
let compressionLoading = '';
const KINDS: Kind[] = ['images', 'shrink', 'audio', 'voice', 'video'];
/** The selected project's estimate (see estimateCompression), for its settings as they were when asked. */
let estimate: { path: string; settings: string; result: Estimate | null; error: string | null } | null = null;
const OFF = 'Keep as they are';
/** Choices in each list; a value set by hand in export.json is added to its list. */
const PRESETS: Record<Kind, [string | number, string][]> = {
  images: [['off', OFF], ['lossless', 'WebP, lossless'], [95, 'WebP, quality 95'], [90, 'WebP, quality 90'], [85, 'WebP, quality 85'], [80, 'WebP, quality 80'], [75, 'WebP, quality 75']],
  shrink: [['off', OFF], [100, 'To the screen’s size'], [150, 'To 1.5 × the screen'], [200, 'To 2 × the screen (sharp on 4K screens)']],
  audio: [['off', OFF], [192, 'Opus, 192 kbit/s'], [160, 'Opus, 160 kbit/s'], [128, 'Opus, 128 kbit/s'], [96, 'Opus, 96 kbit/s'], [64, 'Opus, 64 kbit/s'], [48, 'Opus, 48 kbit/s']],
  voice: [['audio', 'Same as music and sound'], ['off', OFF], [64, 'Opus, 64 kbit/s'], [48, 'Opus, 48 kbit/s'], [40, 'Opus, 40 kbit/s'], [32, 'Opus, 32 kbit/s'], [24, 'Opus, 24 kbit/s']],
  video: [['off', OFF], [18, 'H.264, near original (CRF 18)'], [20, 'H.264, high quality (CRF 20)'], [23, 'H.264, balanced (CRF 23)'], [26, 'H.264, smaller (CRF 26)'], [28, 'H.264, small (CRF 28)']],
};
const customLabel = (kind: Kind, v: string | number) => kind === 'images' ? `WebP, quality ${v}` : kind === 'shrink' ? `To ${v}% of the screen`
  : kind === 'video' ? `H.264, CRF ${v}` : `Opus, ${v} kbit/s`;
const SHORT: Record<Kind, string> = { images: 'pictures', shrink: 'large pictures', audio: 'sound', voice: 'voices', video: 'movies' };
const ESTIMATED = { images: 'Pictures', audio: 'Music and sound', voice: 'Voices', video: 'Movies' } as const;
const HINTS: Partial<Record<Kind, string>> = {
  audio: 'WAV, FLAC, OGG and MP3 to Opus. Mono files get half.',
  voice: 'The files the story plays as voices, and any in a voice folder, to Opus.',
  video: 'MP4, MOV, AVI and others to H.264. WebM is kept.',
};
function size(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(gb < 10 ? 2 : 1)} GB` : `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

function stored(key: string, allowed: string[] | null, fallback: string): string {
  try { const v = localStorage.getItem(key); return v && (!allowed || allowed.includes(v)) ? v : fallback; } catch { return fallback; }
}
function remember(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } }

async function api<T>(route: string, data?: object): Promise<T> {
  const res = await fetch(`/__launcher/${route}`, data === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const result = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error(result.error ?? `The request failed (${res.status}).`);
  return result;
}

function errorMessage(err: unknown): string { return err instanceof Error ? err.message : String(err); }
function notice(message: string): void { $('notice').textContent = message; $('notice').hidden = !message; }
function showError(id: string, err: unknown): void { $(id).textContent = errorMessage(err); $(id).hidden = false; }
function current(): Project | undefined { return state.projects.find((p) => p.path === selected); }
function joinPath(parent: string, name: string): string { return `${parent.replace(/[\\/]+$/, '')}${state.platform === 'win32' ? '\\' : '/'}${name}`; }

function select(path: string): void {
  selected = path;
  remember('emaki-launcher:selected', path);
  render();
  void loadInfo(path);
}

/** A colour of its own for each project without a picture. */
function hue(text: string): string {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return `hsl(${h} 38% 34%)`;
}
function initial(title: string): string { return [...title.trim()][0]?.toLocaleUpperCase() ?? '?'; }
function pictureUrl(path: string, info: ProjectInfo): string { return `/__launcher/picture?path=${encodeURIComponent(path)}&v=${info.at}`; }

function thumb(p: Project): HTMLElement {
  const box = document.createElement('span');
  box.className = 'thumb';
  box.style.setProperty('--thumb', hue(p.title));
  box.textContent = initial(p.title);
  const info = infos.get(p.path)?.info;
  if (info?.picture) {
    const img = document.createElement('img');
    img.src = pictureUrl(p.path, info); img.alt = ''; img.loading = 'lazy';
    img.onerror = () => img.remove();
    box.append(img);
  }
  if (state.sessions.some((s) => s.path === p.path)) {
    const dot = document.createElement('i'); dot.className = 'running'; dot.title = 'Running';
    box.append(dot);
  }
  return box;
}

function render(): void {
  const project = current();
  const query = input('search').value.trim().toLocaleLowerCase();
  const visible = state.projects.filter((p) => `${p.title} ${p.path}`.toLocaleLowerCase().includes(query));
  const thumbs = visible.map((p) => [infos.get(p.path)?.info?.picture ?? null, infos.get(p.path)?.info?.at ?? 0, state.sessions.some((s) => s.path === p.path)]);
  const signature = JSON.stringify([visible, selected, thumbs]);
  if (signature !== listSignature) {
    listSignature = signature;
    const list = $('project-list');
    list.replaceChildren();
    for (const p of visible) {
      const row = document.createElement('button');
      row.className = 'project-row';
      row.setAttribute('aria-current', String(p.path === selected));
      row.title = p.path;
      const content = document.createElement('span'); content.className = 'row-text';
      const title = document.createElement('span'); title.className = 'row-title'; title.textContent = p.title;
      const path = document.createElement('span'); path.className = `row-path${p.available ? '' : ' missing'}`; path.textContent = p.available ? p.path : 'Folder not found';
      content.append(title, path); row.append(thumb(p), content);
      row.addEventListener('click', () => select(p.path));
      row.addEventListener('dblclick', () => { select(p.path); if (p.available) void launch('editor'); });
      list.append(row);
    }
    if (!visible.length) {
      const empty = document.createElement('p'); empty.className = 'list-empty';
      empty.textContent = query ? 'No matching projects.' : 'Projects you create or open will appear here.';
      list.append(empty);
    }
  }
  $('project-count').textContent = String(state.projects.length);
  $('welcome').hidden = !!project;
  $('project-detail').hidden = !project;
  for (const id of ['new-project', 'welcome-new', 'welcome-open', 'open-project', 'example']) button(id).disabled = !connected;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#workspace-seg [data-workspace]')) b.setAttribute('aria-pressed', String(b.dataset.workspace === workspace));
  for (const b of document.querySelectorAll<HTMLButtonElement>('#target-seg [data-target]')) b.setAttribute('aria-pressed', String(b.dataset.target === target));
  $('target-note').textContent = TARGET_NOTES[target]!;
  if (!project) { document.title = 'Emaki projects'; return; }
  renderCompression();
  const infoState = infos.get(project.path) ?? null;
  const nextDetail = JSON.stringify([project, state.sessions.filter((s) => s.path === selected), [...pending], connected, infoState]);
  if (detailSignature !== nextDetail) {
    detailSignature = nextDetail;
    $('project-title').textContent = project.title;
    $('project-path').textContent = project.path;
    $('missing-project').hidden = project.available;
    $('last-opened').textContent = `Last opened ${new Date(project.lastOpened).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
    document.title = `${project.title} · Emaki`;
    renderPicture(project, infoState);
    renderStats(project, infoState);
    button('edit').disabled = !connected || !project.available || pending.has('editor');
    button('play').disabled = !connected || !project.available || pending.has('play');
    button('edit').firstChild!.textContent = pending.has('editor') ? 'Starting the editor… ' : 'Open editor ';
    button('play').textContent = pending.has('play') ? 'Starting the player…' : studio ? 'Play in a window' : 'Play in a browser tab';
    button('folder').disabled = !connected || !project.available;
    const rows = $('sessions'); rows.replaceChildren();
    for (const kind of ['editor', 'play'] as const) {
      const session = state.sessions.find((s) => s.path === selected && s.kind === kind);
      const row = document.createElement('div'); row.className = 'session-row';
      const name = document.createElement('span'); name.className = 'session-name'; name.textContent = kind === 'editor' ? 'Editor' : 'Player';
      const status = document.createElement('span');
      status.className = `session-state${pending.has(kind) ? ' starting' : session ? ' running' : ''}`;
      status.textContent = pending.has(kind) ? 'Starting…' : session ? 'Running' : 'Not running';
      row.append(name, status);
      if (session) {
        const link = document.createElement('a'); link.href = session.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = studio ? 'Open window ↗' : 'Open tab ↗';
        const stop = document.createElement('button'); stop.textContent = 'Stop'; stop.disabled = !connected || pending.has(kind);
        const sessionPath = session.path;
        stop.addEventListener('click', () => { void action(async () => {
          stop.disabled = true;
          try { await api('stop', { path: sessionPath, kind }); }
          finally { detailSignature = ''; await refresh(); }
        }); });
        row.append(link, stop);
      }
      rows.append(row);
    }
  }
  const job = [...state.jobs].reverse().find((j) => j.path === selected);
  const running = state.jobs.some((j) => j.status === 'running');
  const canRemove = connected && !state.sessions.some((s) => s.path === selected) && pending.size === 0 && job?.status !== 'running';
  button('remove-project').disabled = !canRemove;
  button('remove-project').title = canRemove ? 'Remove this entry. No files are deleted.' : 'Stop this project’s sessions and wait for its export to finish first.';
  button('export').disabled = !connected || !project.available || running || busy;
  button('export').textContent = running ? 'Exporting…' : 'Export';
  $('export-progress').hidden = !job;
  if (job) {
    $('export-status').textContent = job.status === 'running' ? `Building the ${TARGET_NAMES[job.target] ?? job.target} version…` : job.status === 'done' ? 'Export complete' : 'Export failed: see the build output below';
    const log = $('export-log');
    if (log.textContent !== job.log) { const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40; log.textContent = job.log || 'Starting the build…'; if (atEnd) log.scrollTop = log.scrollHeight; }
    button('output-folder').hidden = job.status !== 'done';
    button('output-folder').disabled = !connected;
    if (job.status === 'failed') $<HTMLDetailsElement>('export-details').open = true;
  }
}

async function loadCompression(path: string, recheck = false): Promise<void> {
  if (compressionLoading === path) return;
  compressionLoading = path;
  try {
    const next = await api<CompressionState>(`compression?path=${encodeURIComponent(path)}${recheck ? '&recheck' : ''}`);
    if (path === selected) { compression = { path, state: next }; $('compress-error').hidden = true; }
  } catch (err) {
    if (path === selected) showError('compress-error', err);
  } finally { compressionLoading = ''; renderCompression(); }
  void loadEstimate(path);
}

/** Work out how much smaller the export will be, while the section is open (it converts a few files of each kind). */
async function loadEstimate(path: string): Promise<void> {
  const s = compression?.path === path ? compression.state : null;
  if (!s || path !== selected || !$<HTMLDetailsElement>('compress').open) return;
  const settings = JSON.stringify(s.settings);
  if (estimate?.path === path && estimate.settings === settings && !estimate.error) return;
  estimate = { path, settings, result: null, error: null };
  renderEstimate();
  try {
    const r = await api<{ settings: Compression; estimate: Estimate }>(`estimate?path=${encodeURIComponent(path)}`);
    if (estimate?.path === path && estimate.settings === settings && JSON.stringify(r.settings) === settings) estimate = { ...estimate, result: r.estimate };
  } catch (err) {
    if (estimate?.path === path && estimate.settings === settings) estimate = { ...estimate, error: errorMessage(err) };
  }
  renderEstimate();
}

function renderEstimate(): void {
  const box = $('compress-estimate');
  const s = compression?.path === selected ? compression.state : null;
  const e = estimate?.path === selected && s && estimate.settings === JSON.stringify(s.settings) ? estimate : null;
  const on = s ? KINDS.some((k) => s.settings[k] !== 'off' && s.settings[k] !== 'audio') : false;
  box.hidden = !e || !on;
  if (box.hidden || !e) return;
  box.classList.toggle('form-error', !!e.error);
  if (e.error) { box.textContent = `Couldn’t estimate the export: ${e.error}`; return; }
  const r = e.result;
  if (!r) { box.textContent = 'Working out how much smaller the export will be…'; return; }
  if (!r.before) { box.textContent = 'No files in assets are affected by these settings.'; return; }
  const kinds = (['images', 'audio', 'voice', 'video'] as const).filter((k) => r[k].files);
  const exact = kinds.every((k) => r[k].exact);
  const saved = Math.max(0, Math.round((1 - r.after / r.before) * 100));
  const head = document.createElement('strong');
  head.textContent = `${size(r.before)} → ${exact ? '' : 'about '}${size(r.after)} (${saved}% smaller)`;
  const rest = document.createElement('span');
  rest.textContent = ` · ${kinds.map((k) => `${ESTIMATED[k]} ${size(r[k].before)} → ${r[k].exact ? '' : '~'}${size(r[k].after)}`).join(' · ')}`
    + (exact ? '' : '. Worked out from a few files of each kind; the export reuses them.');
  box.replaceChildren(head, rest);
}

function renderCompression(): void {
  const s = compression?.path === selected ? compression.state : null;
  if (!s && connected && selected && current()?.available) void loadCompression(selected);
  const exporting = state.jobs.some((j) => j.status === 'running');
  const on: string[] = [];
  for (const kind of KINDS) {
    const select = $<HTMLSelectElement>(`compress-${kind}`);
    const value = s ? String(s.settings[kind]) : kind === 'voice' ? 'audio' : 'off';
    const missing = kind === 'images' || kind === 'shrink' ? null : s?.missing[kind] ?? null;
    const choices = [...PRESETS[kind]];
    if (!choices.some(([v]) => String(v) === value)) choices.push([value, customLabel(kind, value)]);
    const signature = JSON.stringify(choices);
    if (select.dataset.choices !== signature) {
      select.dataset.choices = signature;
      select.replaceChildren(...choices.map(([v, label]) => { const o = document.createElement('option'); o.value = String(v); o.textContent = label; return o; }));
    }
    if (document.activeElement !== select) select.value = value;
    select.disabled = !s || !connected || exporting || (!!missing && (value === 'off' || value === 'audio'));
    const hintText = HINTS[kind];
    if (hintText) {
      const hint = $(`compress-${kind}-hint`);
      hint.textContent = missing ? `Needs ffmpeg: ${missing}.` : hintText;
      hint.classList.toggle('form-error', !!missing && value !== 'off' && !(value === 'audio' && s?.settings.audio === 'off'));
    }
    if (value !== 'off' && value !== 'audio') {
      on.push(`${SHORT[kind]} ${kind === 'images' ? (value === 'lossless' ? 'lossless' : `q${value}`) : kind === 'shrink' ? `to ${value}%`
        : kind === 'video' ? `CRF ${value}` : `${value} kbit/s`}`);
    }
  }
  $('compress-summary').textContent = s ? (on.length ? on.join(' · ') : 'off') : '';
  renderEstimate();
}

async function saveCompression(kind: Kind, raw: string): Promise<void> {
  const s = compression?.path === selected ? compression.state : null;
  if (!s) return;
  const path = selected;
  const value = raw === 'off' || raw === 'lossless' || raw === 'audio' ? raw : Number(raw);
  try {
    const saved = await api<{ settings: Compression }>('compression', { path, settings: { ...s.settings, [kind]: value } });
    if (path === selected) { compression = { path, state: { ...s, settings: saved.settings } }; $('compress-error').hidden = true; }
  } catch (err) { showError('compress-error', err); }
  renderCompression();
  void loadEstimate(path);
}

function renderPicture(project: Project, s: InfoState | null): void {
  $('hero-picture').style.setProperty('--thumb', hue(project.title));
  const img = $<HTMLImageElement>('picture');
  const letter = $('picture-initial');
  letter.textContent = initial(project.title);
  const src = s?.info?.picture ? pictureUrl(project.path, s.info) : '';
  if (!src) { img.hidden = true; img.removeAttribute('src'); letter.hidden = false; return; }
  if (img.getAttribute('src') !== src) {
    img.onload = () => { img.hidden = false; letter.hidden = true; };
    img.onerror = () => { img.hidden = true; letter.hidden = false; };
    img.src = src;
  }
}

function renderStats(project: Project, s: InfoState | null): void {
  const health = $('health');
  const info = s?.info;
  const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;
  const say = (cls: string, title: string, detail?: string | null) => {
    health.className = `health ${cls}`;
    const dot = document.createElement('i'); dot.className = 'dot';
    const text = document.createElement('div');
    const b = document.createElement('b'); b.textContent = title;
    text.append(b);
    if (detail) { const d = document.createElement('span'); d.className = 'detail'; d.textContent = detail; text.append(d); }
    health.replaceChildren(dot, text);
  };
  if (!project.available) say('error', 'The project’s folder can’t be found.');
  else if (!info && s?.error) say('error', 'The story couldn’t be read.', s.error);
  else if (!info) say('working', 'Reading the story…', 'A long game takes a few seconds the first time.');
  else if (info.errors) say('error', `${plural(info.errors, 'error')}${info.warnings ? ` and ${plural(info.warnings, 'warning')}` : ''}: the game won’t start until they’re fixed`, info.firstProblem);
  else if (info.warnings) say('warn', `${plural(info.warnings, 'warning')}: the game runs, but have a look`, info.firstProblem);
  else say('ok', s?.working ? 'No problems (checking the latest changes…)' : 'No problems: the story compiles');
  const tiles: [string, number | undefined][] = [
    ['scenes', info?.scenes], ['words', info?.words], ['choices', info?.choices], ['endings', info?.endings], ['story files', info?.files], ['lines', info?.lines],
  ];
  $('stats').replaceChildren(...tiles.map(([label, n]) => {
    const tile = document.createElement('div');
    tile.className = `stat${n === undefined ? ' placeholder' : ''}`;
    const b = document.createElement('b'); b.textContent = n === undefined ? '–' : n >= 10_000 ? compact.format(n) : n.toLocaleString();
    if (n !== undefined && n >= 10_000) b.title = n.toLocaleString();
    const span = document.createElement('span'); span.textContent = label;
    tile.append(b, span);
    return tile;
  }));
}

/** Ask for a project's info; the server works it out once per version of the story, so asking again is cheap. */
async function loadInfo(path: string): Promise<void> {
  if (!path || !state.projects.find((p) => p.path === path)?.available) return;
  try {
    infos.set(path, await api<InfoState>(`info?path=${encodeURIComponent(path)}`));
    render();
  } catch { /* the next refresh asks again */ }
}

function setConnection(on: boolean): void {
  const pill = $('connection');
  pill.className = `connection ${on ? 'on' : 'off'}`;
  pill.lastElementChild!.textContent = on ? 'Connected' : 'Disconnected: start the launcher again in its terminal';
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    state = await api<State>('state');
    connected = true;
    if (!current()) selected = state.projects[0]?.path ?? '';
    setConnection(true);
    void loadInfo(selected);
    // The other projects' pictures and numbers, one project at a time in the background.
    const missing = state.projects.find((p) => p.available && p.path !== selected && !infos.get(p.path)?.info && !infos.get(p.path)?.error);
    if (missing) void loadInfo(missing.path);
  } catch {
    connected = false;
    setConnection(false);
  } finally { refreshing = false; render(); }
}

async function action(fn: () => Promise<void>): Promise<void> {
  notice('');
  try { await fn(); } catch (err) { notice(errorMessage(err)); await refresh(); }
}

async function launch(kind: SessionKind): Promise<void> {
  if (pending.has(kind) || !current()?.available || !connected) return;
  const path = selected;
  // Open during the click gesture so browsers don't block the tab after the server starts.
  const tab = window.open('about:blank', '_blank');
  if (tab) { tab.opener = null; tab.document.title = 'Starting Emaki…'; tab.document.body.textContent = 'Starting Emaki. This tab will open your project shortly.'; }
  pending.add(kind); render();
  await action(async () => {
    try {
      const session = await api<Session>('start', { path, kind });
      // The editor opens in the workspace chosen beside its button.
      const url = kind === 'editor' ? `${session.url}${session.url.includes('?') ? '&' : '?'}workspace=${workspace}` : session.url;
      if (tab && !tab.closed) tab.location.replace(url);
      else notice(`Your session is ready. Use ${studio ? 'Open window' : 'Open tab'} under Running to open it.`);
    } catch (err) { tab?.close(); throw err; }
    finally { pending.delete(kind); await refresh(); }
  });
}

function updatePath(): void { $('create-path').textContent = joinPath(input('parent').value, input('folder-name').value || 'project-folder'); }

function openProjectDialog(next: 'create' | 'open'): void {
  mode = next; folderEdited = false;
  $('dialog-title').textContent = next === 'create' ? 'New project' : 'Open a project';
  $('dialog-description').textContent = next === 'create' ? 'You start with a short story that already plays. Change its title and look whenever you like.' : 'Open an Emaki game from your computer. Its files stay where they are.';
  $('create-fields').hidden = next !== 'create'; $('open-fields').hidden = next !== 'open';
  input('title').value = ''; input('folder-name').value = ''; input('parent').value = state.defaultDirectory;
  input('existing-path').value = ''; $('project-error').hidden = true;
  button('project-submit').textContent = next === 'create' ? 'Create project' : 'Open project';
  button('project-submit').disabled = false;
  updatePath();
  $<HTMLDialogElement>('project-dialog').showModal();
  input(next === 'create' ? 'title' : 'existing-path').focus();
}

async function loadFolders(path: string): Promise<void> {
  const request = ++browseRequest;
  $('browse-error').hidden = true; button('select-folder').disabled = true;
  try {
    const next = await api<Folders>(`browse?path=${encodeURIComponent(path)}`);
    if (request !== browseRequest) return;
    folders = next;
    input('browse-path').value = next.path;
    button('up').disabled = !next.parent;
    const list = $('folders'); list.replaceChildren();
    for (const folder of next.folders) {
      const row = document.createElement('button'); row.className = 'folder-row'; row.textContent = folder;
      row.addEventListener('click', () => { void loadFolders(joinPath(next.path, folder)); });
      list.append(row);
    }
    if (!next.folders.length) { const empty = document.createElement('p'); empty.className = 'field-hint'; empty.textContent = 'No folders here.'; list.append(empty); }
    const roots = $('roots'); roots.replaceChildren();
    for (const location of [state.home, ...next.roots]) {
      const root = document.createElement('button'); root.textContent = location === state.home ? 'Home' : location; root.title = location;
      root.addEventListener('click', () => { void loadFolders(location); }); roots.append(root);
    }
    $('browse-info').textContent = next.game ? 'This folder has an Emaki game (story.vn).' : folderTarget === 'existing-path' ? 'Open a folder that has a story.vn.' : 'Your new project folder will be made inside this one.';
    button('select-folder').disabled = folderTarget === 'existing-path' && !next.game;
  } catch (err) { if (request === browseRequest) showError('browse-error', err); }
}

async function pickWithStudio(bridge: StudioBridge, next: 'parent' | 'existing-path'): Promise<void> {
  const title = next === 'parent' ? 'Choose where to make the project' : 'Choose a game folder';
  const path = await bridge.pickFolder({ title, defaultPath: input(next).value || state.home });
  if (!path) return;
  input(next).value = path; updatePath();
}

function openBrowser(next: 'parent' | 'existing-path'): void {
  if (studio) { void action(() => pickWithStudio(studio, next)); return; }
  folderTarget = next; folders = null;
  $('folder-title').textContent = next === 'parent' ? 'Choose where to make the project' : 'Choose a game folder';
  $('folders').replaceChildren(); $('roots').replaceChildren(); $('browse-info').textContent = '';
  input('browse-path').value = input(next).value || state.home;
  $<HTMLDialogElement>('folder-dialog').showModal();
  // A default location may not exist yet. The first browse starts at Home.
  void loadFolders(next === 'parent' && input(next).value === state.defaultDirectory ? state.home : input(next).value || state.home);
}

button('new-project').onclick = button('welcome-new').onclick = () => openProjectDialog('create');
button('open-project').onclick = button('welcome-open').onclick = () => openProjectDialog('open');
for (const b of document.querySelectorAll<HTMLButtonElement>('#workspace-seg [data-workspace]')) {
  b.onclick = () => { workspace = b.dataset.workspace!; remember('emaki-launcher:workspace', workspace); render(); };
}
for (const b of document.querySelectorAll<HTMLButtonElement>('#target-seg [data-target]')) {
  b.onclick = () => { target = b.dataset.target!; remember('emaki-launcher:target', target); render(); };
}
input('search').addEventListener('input', render);
button('edit').onclick = () => { void launch('editor'); };
button('play').onclick = () => { void launch('play'); };
button('folder').onclick = () => { void action(async () => { await api('folder', { path: selected }); }); };
button('output-folder').onclick = () => { void action(async () => { await api('folder', { path: selected, output: true }); }); };
button('remove-project').onclick = () => { void action(async () => { await api('remove', { path: selected }); await refresh(); }); };
button('example').onclick = () => { void action(async () => { const project = await api<Project>('example', {}); await refresh(); select(project.path); }); };
for (const close of document.querySelectorAll<HTMLButtonElement>('[data-close]')) close.onclick = () => $<HTMLDialogElement>(close.dataset.close!).close();
button('browse-parent').onclick = () => openBrowser('parent');
button('browse-existing').onclick = () => openBrowser('existing-path');
input('title').addEventListener('input', () => {
  if (!folderEdited) input('folder-name').value = input('title').value.toLocaleLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').trim().replace(/\s+/g, '-').slice(0, 100);
  updatePath();
});
input('folder-name').addEventListener('input', () => { folderEdited = true; updatePath(); });
input('parent').addEventListener('input', updatePath);
$<HTMLFormElement>('project-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const submit = button('project-submit');
  if (submit.disabled) return;
  submit.disabled = true; $('project-error').hidden = true;
  void (async () => {
    try {
      const project = await api<Project>(mode === 'create' ? 'create' : 'open', mode === 'create'
        ? { title: input('title').value, parent: input('parent').value, folder: input('folder-name').value }
        : { path: input('existing-path').value });
      $<HTMLDialogElement>('project-dialog').close();
      input('search').value = '';
      await refresh(); select(project.path);
    } catch (err) { showError('project-error', err); }
    finally { submit.disabled = false; }
  })();
});
$<HTMLFormElement>('browse-form').onsubmit = (event) => { event.preventDefault(); void loadFolders(input('browse-path').value); };
button('up').onclick = () => { if (folders?.parent) void loadFolders(folders.parent); };
button('select-folder').onclick = () => {
  if (!folders || button('select-folder').disabled) return;
  input(folderTarget).value = folders.path; updatePath();
  $<HTMLDialogElement>('folder-dialog').close();
};
for (const kind of KINDS) {
  $<HTMLSelectElement>(`compress-${kind}`).addEventListener('change', (event) => { void saveCompression(kind, (event.target as HTMLSelectElement).value); });
}
// ffmpeg may have been installed since: look again when the section is opened.
$<HTMLDetailsElement>('compress').addEventListener('toggle', () => { if ($<HTMLDetailsElement>('compress').open && selected) void loadCompression(selected, true); });
$<HTMLFormElement>('export-form').onsubmit = (event) => {
  event.preventDefault();
  if (button('export').disabled) return;
  busy = true; render();
  void action(async () => {
    try {
      await api('export', { path: selected, target });
      $<HTMLDetailsElement>('export-details').open = true;
    } finally { busy = false; await refresh(); }
  });
};
void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
