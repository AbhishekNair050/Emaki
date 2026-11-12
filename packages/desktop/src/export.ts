/**
 * Desktop export: wraps a game's web build in Electron for Windows, macOS and Linux.
 *
 * The app is assembled in a staging folder (the shell from ../app, the web
 * build as game/, and a small emaki.json), then packaged with
 * @electron/packager, which downloads the matching Electron for the target
 * platform, so Windows, macOS and Linux builds can all be made from one machine
 * (macOS builds are unsigned; see the docs).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { packager } from '@electron/packager';
import { pngToIco } from './icon.ts';

export type DesktopPlatform = 'win32' | 'darwin' | 'linux';

export interface DesktopExportOptions {
  /** The game's web build (index.html and assets). */
  webDir: string;
  /** Where the packaged app folder goes. */
  outDir: string;
  /** From the story header. */
  title: string;
  author?: string;
  version?: string;
  appId: string;
  /** Steam App ID: turns on Steamworks (achievements, overlay). */
  steamAppId?: number | null;
  /** A square PNG (ideally 512×512 or larger) for the window and the executable. */
  iconPng?: string | null;
  platform?: DesktopPlatform;
  arch?: 'x64' | 'arm64';
  /** Languages the game is translated into: Chromium's own files for other languages are left out (about 45 MB). */
  languages?: string[];
  log?: (msg: string) => void;
}

const appTemplate = resolve(import.meta.dirname, '../app');
const require = createRequire(import.meta.url);

/** Returns the folder holding the packaged app (e.g. .../The Pier-win32-x64). */
export async function exportDesktop(o: DesktopExportOptions): Promise<string> {
  const log = o.log ?? (() => {});
  const platform = o.platform ?? (process.platform as DesktopPlatform);
  const arch = o.arch ?? (process.arch === 'arm64' ? 'arm64' : 'x64');
  const name = productName(o.title);
  const stage = join(o.outDir, '.staging');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  // The shell and the game.
  for (const f of ['main.mjs', 'preload.cjs']) cpSync(join(appTemplate, f), join(stage, f));
  cpSync(o.webDir, join(stage, 'game'), { recursive: true });
  writeFileSync(join(stage, 'emaki.json'), JSON.stringify({ title: o.title, steamAppId: o.steamAppId ?? null }, null, 2));
  writeFileSync(join(stage, 'package.json'), JSON.stringify({
    name: o.appId.toLowerCase().replace(/[^a-z0-9.-]/g, '-'),
    productName: name,
    version: semver(o.version),
    description: o.title,
    ...(o.author ? { author: o.author } : {}),
    main: 'main.mjs',
    type: 'module',
  }, null, 2));

  let icon: string | undefined;
  if (o.iconPng && existsSync(o.iconPng)) {
    cpSync(o.iconPng, join(stage, 'icon.png'));
    if (platform === 'win32') {
      icon = join(o.outDir, '.icon.ico');
      writeFileSync(icon, pngToIco(readFileSync(o.iconPng)));
    } else if (platform === 'linux') {
      icon = o.iconPng;
    }
    // macOS needs an .icns; without one the default icon is used.
  }

  // Steamworks: a native module with Steam's own library, only for games on Steam.
  if (o.steamAppId) {
    const pkg = dirname(require.resolve('steamworks.js/package.json'));
    const keep = platform === 'win32' ? 'win64' : platform === 'darwin' ? 'osx' : 'linux64';
    const dest = join(stage, 'node_modules', 'steamworks.js');
    cpSync(pkg, dest, {
      recursive: true,
      filter: (src) => !/[\\/]dist[\\/](win64|osx|linux64)/.test(src) || new RegExp(`[\\\\/]dist[\\\\/]${keep}`).test(src),
    });
    log(`Steamworks included (App ID ${o.steamAppId})`);
  }

  const electronVersion = (JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8')) as { version: string }).version;
  log(`Packaging with Electron ${electronVersion} for ${platform}-${arch}…`);
  const [out] = await packager({
    dir: stage,
    out: o.outDir,
    name,
    platform,
    arch,
    electronVersion,
    appVersion: semver(o.version),
    appBundleId: o.appId,
    ...(icon ? { icon } : {}),
    overwrite: true,
    prune: false,
    quiet: true,
    // Native modules can't be loaded from inside an asar archive.
    asar: { unpack: '**/*.{node,dll,so,dylib}' },
    win32metadata: win32Metadata(o.title, o.author),
  });
  rmSync(stage, { recursive: true, force: true });
  if (icon && icon.endsWith('.ico')) rmSync(icon, { force: true });
  if (!out) throw new Error('Packaging produced nothing.');
  pruneLocales(out, o.languages ?? []);
  return out;
}

/**
 * Chromium ships its menus and dialogs in ~55 languages. A game shows none of
 * them, so keep English and the game's own languages only.
 */
export function pruneLocales(appDir: string, languages: string[]): void {
  const dir = join(appDir, 'locales');
  if (!existsSync(dir)) return; // macOS keeps them inside the bundle; left alone
  const keep = new Set(['en-us', ...languages.map((l) => l.toLowerCase()), ...languages.map((l) => l.split('-')[0]!.toLowerCase())]);
  for (const f of readdirSync(dir)) {
    const code = f.replace(/\.pak(\.info)?$/, '').toLowerCase();
    if (!keep.has(code) && !keep.has(code.split('-')[0]!)) rmSync(join(dir, f), { force: true });
  }
}

/** A name that is safe as a file and folder name on every OS. */
/**
 * The Windows executable's details. The packager needs a company name and
 * fails without one, so a game with no author uses its title.
 */
export function win32Metadata(title: string, author?: string): { ProductName: string; FileDescription: string; CompanyName: string } {
  return { ProductName: productName(title), FileDescription: title, CompanyName: author?.trim() || title };
}

export function productName(title: string): string {
  return title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64) || 'Emaki Game';
}

/** Electron wants x.y.z. */
export function semver(v: string | undefined): string {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v ?? '');
  return m ? `${m[1]}.${m[2] ?? 0}.${m[3] ?? 0}` : '1.0.0';
}
