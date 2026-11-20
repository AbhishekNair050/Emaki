/**
 * Packs Emaki Studio into a Windows installer: `npm run build:studio`.
 *
 * 1. Stage the engine as it runs from the repository: the packages, the example game, and the packages they use
 *    at run time, copied from node_modules (not npm's links between the engine's own packages, which installers
 *    can't carry: the Studio makes them when it starts, see src/link.ts).
 * 2. Add Electron with @electron/packager. No asar archive: Vite, esbuild and the exporters read and run these
 *    files as plain files.
 * 3. Make the installer with electron-builder: NSIS, for the current user (the folder can be chosen), so the
 *    install folder stays writable (the links, Vite's caches). Unsigned for now: SmartScreen warns before the first run.
 *
 * Everything goes to packages/studio/out/ (stage, app, installer).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pngToIco } from '../desktop/src/icon.ts';

const here = import.meta.dirname;
const repo = resolve(here, '../..');
const out = join(here, 'out');
const stage = join(out, 'stage');

/** The engine's packages the Studio runs (not the VS Code extension). */
const SHIP = ['cli', 'desktop', 'editor', 'format', 'language', 'mobile', 'player-web', 'runtime', 'studio'];
/** Never part of the engine's packages or the example game as they run. */
const SKIP = new Set(['node_modules', 'test', 'out', 'dist', '.vite', 'export']);
/** In dependencies only their nested node_modules, which are copied as packages of their own. */
const SKIP_IN_DEPENDENCIES = new Set(['node_modules']);
/** Used at run time but declared only at the repository's root (as a dev dependency). */
const ROOT_RUNTIME = ['vite'];

interface Manifest {
  name?: string; version?: string; description?: string;
  dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>;
}
const manifest = (dir: string): Manifest => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;
const log = (line: string) => console.log(line);

/** Copy a folder, leaving out folders named in `skip` at any depth. */
function copy(from: string, to: string, skip: Set<string> = SKIP): void {
  // Entry by entry: Node refuses to copy a folder into its own subfolder (this package's out/), filter or not.
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (skip.has(entry)) continue;
    cpSync(join(from, entry), join(to, entry), {
      recursive: true,
      filter: (src) => relative(from, src).split(sep).every((part) => !skip.has(part)),
    });
  }
}

/** Where Node finds `name` when `from` imports it: the nearest node_modules up to the repository. */
function findPackage(name: string, from: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === repo || dirname(dir) === dir) return null;
  }
}

/** Every package folder the shipped packages need at run time, with its name. */
function runtimePackages(): Map<string, string> {
  const found = new Map<string, string>();
  const queue: { name: string; from: string; optional: boolean }[] = [];
  const need = (m: Manifest, from: string) => {
    for (const name of Object.keys(m.dependencies ?? {})) queue.push({ name, from, optional: false });
    for (const name of Object.keys(m.optionalDependencies ?? {})) queue.push({ name, from, optional: true });
    // Peers are provided by whoever uses the package; when they aren't here, nothing here uses them.
    for (const name of Object.keys(m.peerDependencies ?? {})) queue.push({ name, from, optional: true });
  };
  for (const p of SHIP) need(manifest(join(repo, 'packages', p)), join(repo, 'packages', p));
  for (const name of ROOT_RUNTIME) queue.push({ name, from: repo, optional: false });
  while (queue.length) {
    const { name, from, optional } = queue.pop()!;
    if (name.startsWith('@emaki/')) continue;
    const dir = findPackage(name, from);
    if (!dir) {
      if (optional) continue;
      throw new Error(`${name} (needed from ${relative(repo, from) || 'the repository'}) is not installed. Run npm install.`);
    }
    if (found.has(dir)) continue;
    found.set(dir, name);
    // Desktop exports only read Electron's version, and download the Electron they package.
    if (name === 'electron') continue;
    need(manifest(dir), dir);
  }
  return found;
}

function stageApp(): { version: string; electronVersion: string } {
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const p of SHIP) copy(join(repo, 'packages', p), join(stage, 'packages', p));
  copy(join(repo, 'games', 'gullwing'), join(stage, 'games', 'gullwing'));
  for (const file of ['LICENSE', 'README.md']) if (existsSync(join(repo, file))) cpSync(join(repo, file), join(stage, file));

  let electronVersion = '';
  const packages = runtimePackages();
  for (const [dir, name] of packages) {
    const to = join(stage, relative(repo, dir));
    if (name === 'electron') {
      mkdirSync(to, { recursive: true });
      cpSync(join(dir, 'package.json'), join(to, 'package.json'));
      electronVersion = manifest(dir).version ?? '';
    } else copy(dir, to, SKIP_IN_DEPENDENCIES);
  }
  if (!electronVersion) throw new Error('Electron is not installed. Run npm install.');

  const studio = manifest(join(repo, 'packages', 'studio'));
  const version = studio.version ?? '0.0.0';
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify({
    name: 'emaki-studio', productName: 'Emaki Studio', version, description: studio.description,
    license: 'MIT', author: 'Emaki', private: true, type: 'module', main: 'packages/studio/src/main.ts',
  }, null, 2)}\n`);
  log(`Staged ${SHIP.length} engine packages and ${packages.size} dependencies (Electron ${electronVersion}).`);
  return { version, electronVersion };
}

async function packageApp(version: string, electronVersion: string): Promise<string> {
  const ico = join(out, 'icon.ico');
  writeFileSync(ico, pngToIco(readFileSync(join(here, 'build', 'icon.png'))));
  const { packager } = await import('@electron/packager');
  log('Adding Electron…');
  const [appDir] = await packager({
    dir: stage, out: join(out, 'app'), overwrite: true,
    name: 'Emaki Studio', executableName: 'Emaki Studio', appVersion: version, electronVersion,
    platform: 'win32', arch: 'x64', icon: ico,
    asar: false, prune: false, ignore: () => false, quiet: true,
    win32metadata: { CompanyName: 'Emaki', ProductName: 'Emaki Studio', FileDescription: 'Emaki Studio', InternalName: 'Emaki Studio' },
  });
  if (!appDir) throw new Error('Electron packaging produced no app.');
  return appDir;
}

async function installer(appDir: string, version: string, electronVersion: string): Promise<string> {
  const { build, Platform, Arch } = await import('electron-builder');
  log('Making the installer…');
  const files = await build({
    targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
    prepackaged: appDir,
    projectDir: stage,
    publish: 'never',
    config: {
      appId: 'org.emaki.studio', productName: 'Emaki Studio', executableName: 'Emaki Studio', electronVersion,
      directories: { output: join(out, 'installer') },
      // The packager already set the executable's icon and details; nothing to sign yet.
      win: { icon: join(here, 'build', 'icon.png'), signAndEditExecutable: false },
      nsis: {
        // A few steps, so the folder can be chosen. If it doesn't end in the app's folder name, the installer adds
        // one, so uninstalling removes only the Studio's own folder. Installed without administrator rights: the
        // Studio writes in its folder (package links, Vite's caches), so a protected folder can't be chosen.
        oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
        shortcutName: 'Emaki Studio', createDesktopShortcut: true, createStartMenuShortcut: true, runAfterFinish: true,
        artifactName: `Emaki-Studio-Setup-${version}.exe`, deleteAppDataOnUninstall: false,
      },
    },
  });
  const exe = files.find((f) => f.endsWith('.exe'));
  if (!exe) throw new Error('electron-builder made no installer.');
  return exe;
}

if (process.platform !== 'win32') {
  console.error('The Studio installer is made on Windows for now.');
  process.exit(1);
}
const { version, electronVersion } = stageApp();
const appDir = await packageApp(version, electronVersion);
const exe = await installer(appDir, version, electronVersion);
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
log(`\nApp folder: ${appDir}\nInstaller: ${exe} (${mb(statSync(exe).size)})`);
log(`Unsigned: Windows SmartScreen shows "Windows protected your PC" on first run (More info, then Run anyway). ${basename(exe)} installs for the current user.`);
