// Emaki Studio (Electron main process).
//
// Runs the project launcher (packages/cli) inside the app, on Electron's own
// Node, and shows the launcher, the editor and the player in windows of their
// own. Nothing to install besides the app: no Node, no git, no terminal.
//
// The launcher and the sessions it starts are the same Vite servers
// `npm run launch` uses, on this computer's loopback address only.
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell, type BrowserWindowConstructorOptions, type WebContents } from 'electron';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Launcher } from '@emaki/cli/launcher';
import { linkPackages } from './link.ts';
import { isExternalUrl, isLocalUrl } from './urls.ts';

/** The launcher's own port, apart from `npm run launch` (5175), so both can run at once. */
const PORT = 5185;
/** What pages may ask for. Everything else (camera, location, notifications…) is refused. */
const PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write', 'clipboard-read']);

// The ffmpeg the installed Studio comes with (see build.ts), for exports' sound and movies, unless one is set already.
const ffmpeg = resolve(import.meta.dirname, '../../../vendor/ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
if (!process.env.FFMPEG_PATH && existsSync(ffmpeg)) process.env.FFMPEG_PATH = ffmpeg;

app.setName('Emaki Studio');
app.setPath('userData', join(app.getPath('appData'), 'Emaki Studio'));
if (process.platform === 'win32') app.setAppUserModelId('org.emaki.studio');

let launcher: Launcher | null = null;
let main: BrowserWindow | null = null;
let quitting = false;

/** The launcher's background, so windows don't flash white while they load. */
const background = () => (nativeTheme.shouldUseDarkColors ? '#121317' : '#e9e8e3');

function windowOptions(extra: BrowserWindowConstructorOptions = {}): BrowserWindowConstructorOptions {
  return {
    width: 1440, height: 900, minWidth: 720, minHeight: 480,
    autoHideMenuBar: true, backgroundColor: background(),
    ...extra,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, ...extra.webPreferences },
  };
}

/** Every page stays on the local servers; other links open in the system browser. */
function guard(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    // The launcher opens a blank window during the click, then points it at the session once it has started.
    if (url === 'about:blank' || isLocalUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: windowOptions() };
    if (isExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isLocalUrl(url)) return;
    event.preventDefault();
    if (isExternalUrl(url)) void shell.openExternal(url);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function startingPage(): string {
  const html = `<!doctype html><meta charset="utf-8"><title>Emaki Studio</title>
<style>html{color-scheme:light dark;background:${background()};font:15px system-ui,sans-serif;height:100%;display:grid;place-items:center;opacity:.7}</style>
<p>Starting Emaki Studio…</p>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function openLauncherWindow(): BrowserWindow {
  const win = new BrowserWindow(windowOptions({
    width: 1180, height: 780, title: 'Emaki Studio',
    webPreferences: { preload: join(import.meta.dirname, 'preload.cjs') },
  }));
  // Closing the launcher closes the Studio: the editors and players it started stop with it.
  win.on('close', (event) => {
    if (quitting) return;
    const others = BrowserWindow.getAllWindows().filter((w) => w !== win && !w.isDestroyed());
    if (others.length) {
      const answer = dialog.showMessageBoxSync(win, {
        type: 'question', buttons: ['Close Emaki Studio', 'Cancel'], defaultId: 0, cancelId: 1,
        title: 'Emaki Studio', message: 'Close Emaki Studio?', detail: 'Open editors and players will close too. Your work is already saved.',
      });
      if (answer !== 0) { event.preventDefault(); return; }
    }
    app.quit();
  });
  win.on('closed', () => { if (main === win) main = null; });
  return win;
}

ipcMain.handle('studio:pick-folder', async (event, options: { title?: unknown; defaultPath?: unknown }) => {
  // Only the launcher window has the bridge, and only its own page may use it.
  if (!main || event.sender !== main.webContents || !isLocalUrl(event.senderFrame?.url ?? '')) throw new Error('Not allowed.');
  const title = typeof options?.title === 'string' && options.title ? options.title.slice(0, 200) : 'Choose a folder';
  const wanted = typeof options?.defaultPath === 'string' ? options.defaultPath : '';
  // A default location may not exist yet (the projects folder before the first project).
  const defaultPath = wanted && existsSync(wanted) ? wanted : app.getPath('home');
  const result = await dialog.showOpenDialog(main, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

app.on('web-contents-created', (_event, contents) => guard(contents));

app.on('second-instance', () => {
  if (!main) return;
  if (main.isMinimized()) main.restore();
  main.focus();
});

app.on('before-quit', (event) => {
  if (quitting || !launcher) return;
  // Stop the launcher's servers, previews and exports before leaving.
  event.preventDefault();
  quitting = true;
  void launcher.close().catch((err: unknown) => console.error(err)).finally(() => app.quit());
});

app.on('window-all-closed', () => app.quit());

async function start(): Promise<void> {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(isLocalUrl(details.requestingUrl) && PERMISSIONS.has(permission));
  });
  main = openLauncherWindow();
  void main.loadURL(startingPage());
  try {
    // An installed Studio carries the engine's packages but not npm's links between them: make those first.
    if (app.isPackaged) linkPackages(resolve(import.meta.dirname, '../../..'));
    const { startLauncher } = await import('@emaki/cli/launcher');
    launcher = await startLauncher({ port: PORT, open: false });
  } catch (err) {
    dialog.showErrorBox('Emaki Studio could not start', err instanceof Error ? err.message : String(err));
    app.exit(1);
    return;
  }
  if (main) await main.loadURL(launcher.url);
}

// One Studio at a time: a second launch brings the first one forward.
// (No top-level await here: Electron holds back `ready` until the entry module has finished.)
if (!app.requestSingleInstanceLock()) app.exit(0);
else void app.whenReady().then(start);
