import type { Project } from '../src/projects.ts';
import type { Session, SessionKind } from '../src/serve.ts';

interface Job { id: number; path: string; target: string; status: 'running' | 'done' | 'failed'; log: string; output: string }
interface State { projects: Project[]; sessions: Session[]; jobs: Job[]; defaultDirectory: string; home: string; platform: string }
interface Folders { path: string; parent: string | null; folders: string[]; game: boolean; roots: string[] }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const button = (id: string) => $<HTMLButtonElement>(id);
const input = (id: string) => $<HTMLInputElement>(id);
let state: State = { projects: [], sessions: [], jobs: [], defaultDirectory: '', home: '', platform: '' };
let selected = localStorage.getItem('emaki-launcher:selected') ?? '';
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
  localStorage.setItem('emaki-launcher:selected', path);
  render();
}

function render(): void {
  const project = current();
  const query = input('search').value.trim().toLocaleLowerCase();
  const visible = state.projects.filter((p) => `${p.title} ${p.path}`.toLocaleLowerCase().includes(query));
  const signature = JSON.stringify([visible, selected]);
  if (signature !== listSignature) {
    listSignature = signature;
    const list = $('project-list');
    list.replaceChildren();
    for (const p of visible) {
      const row = document.createElement('button');
      row.className = 'project-row';
      row.setAttribute('aria-current', String(p.path === selected));
      row.title = p.path;
      const icon = document.createElement('span');
      icon.className = 'project-icon'; icon.textContent = 'VN'; icon.setAttribute('aria-hidden', 'true');
      const content = document.createElement('span'); content.className = 'project-row-content';
      const title = document.createElement('span'); title.className = 'project-row-title'; title.textContent = p.title;
      const path = document.createElement('span'); path.className = 'project-row-path'; path.textContent = p.available ? p.path : 'Folder not found';
      content.append(title, path); row.append(icon, content);
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
  for (const id of ['new-project', 'welcome-new', 'open-project', 'example']) button(id).disabled = !connected;
  if (!project) return;
  const nextDetail = JSON.stringify([project, state.sessions.filter((s) => s.path === selected), [...pending], connected]);
  if (detailSignature !== nextDetail) {
    detailSignature = nextDetail;
    $('project-title').textContent = project.title;
    $('project-path').textContent = project.path;
    $('missing-project').hidden = project.available;
    $('last-opened').textContent = `Last opened ${new Date(project.lastOpened).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
    document.title = `${project.title} — Emaki`;
    button('edit').disabled = !connected || !project.available || pending.has('editor');
    button('play').disabled = !connected || !project.available || pending.has('play');
    button('edit').firstChild!.textContent = pending.has('editor') ? 'Starting editor… ' : 'Open editor ';
    button('play').firstChild!.textContent = pending.has('play') ? 'Starting player… ' : 'Play ';
    button('folder').disabled = !connected || !project.available;
    const rows = $('sessions'); rows.replaceChildren();
    for (const kind of ['editor', 'play'] as const) {
      const session = state.sessions.find((s) => s.path === selected && s.kind === kind);
      const row = document.createElement('div'); row.className = 'session-row';
      const name = document.createElement('span'); name.className = 'session-name'; name.textContent = kind === 'editor' ? 'Editor' : 'Player';
      const status = document.createElement('span'); status.className = `session-state${session ? ' running' : ''}`;
      status.textContent = pending.has(kind) ? 'Starting…' : session ? 'Running' : 'Not running';
      row.append(name, status);
      if (session) {
        const link = document.createElement('a'); link.href = session.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open tab ↗';
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
  button('remove-project').title = canRemove ? 'Remove this entry without deleting any files.' : 'Stop this project’s sessions and wait for its export to finish first.';
  button('export').disabled = !connected || !project.available || running || busy;
  button('export').textContent = running ? 'Export in progress…' : 'Export';
  $('export-progress').hidden = !job;
  if (job) {
    $('export-status').textContent = job.status === 'running' ? `Building ${job.target === 'web' ? 'web' : 'desktop'} version…` : job.status === 'done' ? 'Export complete' : 'Export failed — see build output below';
    const log = $('export-log');
    if (log.textContent !== job.log) { const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40; log.textContent = job.log || 'Starting build…'; if (atEnd) log.scrollTop = log.scrollHeight; }
    button('output-folder').hidden = job.status !== 'done';
    button('output-folder').disabled = !connected;
    if (job.status === 'failed') $<HTMLDetailsElement>('export-details').open = true;
  }
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    state = await api<State>('state');
    connected = true;
    if (!current()) selected = state.projects[0]?.path ?? '';
    $('connection').textContent = 'Keep the launcher terminal open while working.';
  } catch {
    connected = false;
    $('connection').textContent = 'Launcher disconnected. Start it again in the terminal to reconnect.';
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
      if (tab && !tab.closed) tab.location.replace(session.url);
      else notice('Your session is ready. Use Open tab in Sessions to open it.');
    } catch (err) { tab?.close(); throw err; }
    finally { pending.delete(kind); await refresh(); }
  });
}

function updatePath(): void { $('create-path').textContent = joinPath(input('parent').value, input('folder-name').value || 'project-folder'); }

function openProjectDialog(next: 'create' | 'open'): void {
  mode = next; folderEdited = false;
  $('dialog-title').textContent = next === 'create' ? 'New project' : 'Open project';
  $('dialog-description').textContent = next === 'create' ? 'Start with a short, playable story. You can change its title and appearance at any time.' : 'Open an Emaki game from your computer. Its files stay in their current location.';
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
    if (!next.folders.length) { const empty = document.createElement('p'); empty.className = 'field-hint'; empty.textContent = 'No subfolders here.'; list.append(empty); }
    const roots = $('roots'); roots.replaceChildren();
    for (const location of [state.home, ...next.roots]) {
      const root = document.createElement('button'); root.textContent = location === state.home ? 'Home' : location; root.title = location;
      root.addEventListener('click', () => { void loadFolders(location); }); roots.append(root);
    }
    $('browse-info').textContent = next.game ? 'This folder contains an Emaki game (story.vn).' : folderTarget === 'existing-path' ? 'Open a folder containing story.vn.' : 'Your new project folder will be created inside this location.';
    button('select-folder').disabled = folderTarget === 'existing-path' && !next.game;
  } catch (err) { if (request === browseRequest) showError('browse-error', err); }
}

function openBrowser(target: 'parent' | 'existing-path'): void {
  folderTarget = target; folders = null;
  $('folder-title').textContent = target === 'parent' ? 'Choose a project location' : 'Choose a game folder';
  $('folders').replaceChildren(); $('roots').replaceChildren(); $('browse-info').textContent = '';
  input('browse-path').value = input(target).value || state.home;
  $<HTMLDialogElement>('folder-dialog').showModal();
  // A default location may not exist yet. The first browse starts at Home.
  void loadFolders(target === 'parent' && input(target).value === state.defaultDirectory ? state.home : input(target).value || state.home);
}

button('new-project').onclick = button('welcome-new').onclick = () => openProjectDialog('create');
button('open-project').onclick = () => openProjectDialog('open');
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
$<HTMLSelectElement>('target').onchange = () => { $('desktop-note').hidden = $<HTMLSelectElement>('target').value !== 'desktop'; };
$<HTMLFormElement>('export-form').onsubmit = (event) => {
  event.preventDefault();
  if (button('export').disabled) return;
  busy = true; render();
  void action(async () => {
    try {
      await api('export', { path: selected, target: $<HTMLSelectElement>('target').value });
      $<HTMLDetailsElement>('export-details').open = true;
    } finally { busy = false; await refresh(); }
  });
};
void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
