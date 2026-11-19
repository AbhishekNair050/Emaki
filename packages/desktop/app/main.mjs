// Emaki desktop shell (Electron main process).
//
// Shows the game's web build in a window, served from inside the app over a
// private app:// scheme (file:// can't load module scripts). The game talks
// to this process only through the small bridge in preload.cjs.
//
// Shipped as-is inside every exported game, so it is plain JavaScript.
import { app, BrowserWindow, ipcMain, Menu, net, protocol, screen, shell } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = join(here, 'game');
/** @type {{ title: string; steamAppId: number | null; window?: { width: number; height: number; minWidth: number; minHeight: number; aspect: number } }} */
const config = JSON.parse(readFileSync(join(here, 'emaki.json'), 'utf8'));

// One copy at a time: a second launch focuses the first window.
if (!app.requestSingleInstanceLock()) app.quit();

// --------------------------------------------------------------- Steam (optional)

/** @type {any} */
let steam = null;
if (config.steamAppId) {
  try {
    const steamworks = createRequire(import.meta.url)('steamworks.js');
    steam = steamworks.init(config.steamAppId);
    // Must run before the app is ready: lets the Steam overlay draw over the window.
    steamworks.electronEnableSteamOverlay();
  } catch (err) {
    // Steam not running, or the game wasn't started from Steam: play on without it.
    console.warn(`Steam is not available (${err instanceof Error ? err.message : err}); achievements will be kept locally.`);
    steam = null;
  }
}

// --------------------------------------------------------------- serving the game

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function serveGame() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = normalize(join(gameDir, decodeURIComponent(pathname)));
    // Never serve anything outside the game folder.
    if (file !== gameDir && !file.startsWith(gameDir + sep)) return new Response('Not found', { status: 404 });
    const target = pathname === '/' ? join(gameDir, 'index.html') : file;
    return net.fetch(pathToFileURL(target).toString(), { headers: request.headers });
  });
}

// --------------------------------------------------------------- the window

const stateFile = join(app.getPath('userData'), 'window.json');

/**
 * The window has the game's shape (header `aspect:`), sizes being the inside
 * of the window: 1280×720 for 16:9, 960×720 for 4:3 (see src/window.ts).
 * @type {{ width: number; height: number; minWidth: number; minHeight: number; aspect: number }}
 */
const shape = config.window ?? { width: 1280, height: 720, minWidth: 480, minHeight: 270, aspect: 16 / 9 };

/** The opening size, made smaller (same shape) if the screen can't hold it. */
function openingSize() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const scale = Math.min(1, (area.width * 0.9) / shape.width, (area.height * 0.9) / shape.height);
  return { width: Math.round(shape.width * scale), height: Math.round(shape.height * scale) };
}

function loadWindowState() {
  try {
    const s = JSON.parse(readFileSync(stateFile, 'utf8'));
    // A size saved for another shape (an earlier release, before the window
    // followed the game's) would bring the black bars back: start afresh.
    const sameShape = typeof s.aspect === 'number' && Math.abs(s.aspect - shape.aspect) < 0.01;
    const size = sameShape && s.width > 0 && s.height > 0 ? { width: s.width, height: s.height } : openingSize();
    return { ...size, fullscreen: !!s.fullscreen };
  } catch {
    return { ...openingSize(), fullscreen: false };
  }
}

/** @param {BrowserWindow} win */
function saveWindowState(win) {
  try {
    const full = win.isFullScreen();
    const [width, height] = full ? [loadWindowState().width, loadWindowState().height] : win.getContentSize();
    writeFileSync(stateFile, JSON.stringify({ width, height, fullscreen: full, aspect: shape.aspect }));
  } catch { /* not important */ }
}

function createWindow() {
  const state = loadWindowState();
  const icon = join(here, 'icon.png');
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    // The sizes are the game's area, not counting the title bar and borders.
    useContentSize: true,
    minWidth: shape.minWidth,
    minHeight: shape.minHeight,
    fullscreen: state.fullscreen,
    backgroundColor: '#000000',
    title: config.title,
    ...(existsSync(icon) ? { icon } : {}),
    show: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveWindowState(win));

  // F11 or Alt+Enter: full screen, as players expect from PC games.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.key === 'Enter' && input.alt)) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  // The game never navigates away; links (credits, store pages) open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });

  void win.loadURL('app://game/index.html');
  return win;
}

// --------------------------------------------------------------- bridge

ipcMain.on('emaki:info', (event) => {
  event.returnValue = { steam: !!steam };
});
ipcMain.on('emaki:quit', () => app.quit());
ipcMain.handle('emaki:fullscreen', (event, on) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (typeof on === 'boolean') win.setFullScreen(on);
  return on ?? win.isFullScreen();
});
ipcMain.on('emaki:achieve', (_event, id) => {
  if (!steam || typeof id !== 'string') return;
  try {
    if (!steam.achievement.isActivated(id)) steam.achievement.activate(id);
  } catch (err) {
    console.warn(`Steam achievement '${id}' failed: ${err instanceof Error ? err.message : err}`);
  }
});

// --------------------------------------------------------------- start

Menu.setApplicationMenu(null);
app.setName(config.title);

app.whenReady().then(() => {
  serveGame();
  const win = createWindow();
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
});

app.on('window-all-closed', () => app.quit());
