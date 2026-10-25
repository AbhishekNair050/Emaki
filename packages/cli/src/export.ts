/**
 * `emaki export`: one command from a game folder to something players can run.
 *
 *   web      a static site (itch.io, any web host)
 *   desktop  a Windows, macOS or Linux app (Electron), with Steam support
 *   android  an Android Studio project and, with the Android SDK, a debug APK
 *   ios      an Xcode project (needs a Mac to build)
 *
 * Everything goes into <game>/export/.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { compile } from '@emaki/format';
import { buildWeb } from '@emaki/player-web/build';

export const TARGETS = ['web', 'desktop', 'android', 'ios'] as const;
export type Target = (typeof TARGETS)[number];

export interface ExportArgs {
  target: Target;
  /** The game folder, or its story.vn. */
  game: string;
  platform?: string;
  arch?: string;
  /** android: skip the Gradle build even if the SDK is there. */
  noBuild?: boolean;
}

export interface GameInfo {
  dir: string;
  title: string;
  author?: string;
  version?: string;
  appId: string;
  steamAppId: number | null;
  icon: string | null;
}

/** Read and check the game's header; throws a message for the writer on problems. */
export function gameInfo(game: string, defaultAppId: (title: string) => string): GameInfo {
  const dir = resolve(existsSync(game) && statSync(game).isFile() ? dirname(game) : game);
  const storyPath = join(dir, 'story.vn');
  if (!existsSync(storyPath)) throw new Error(`No story.vn in ${dir}`);
  const r = compile(readFileSync(storyPath, 'utf8'));
  const errors = r.diagnostics.filter((d) => d.severity === 'error');
  if (!r.story) {
    throw new Error(`story.vn has ${errors.length} error(s); run 'emaki check' to see them. The first: line ${errors[0]?.line}: ${errors[0]?.message}`);
  }
  const meta = r.story.meta;
  const title = meta.title?.trim() || basename(dir);
  let steamAppId: number | null = null;
  if (meta.steam_app_id) {
    steamAppId = Number(meta.steam_app_id);
    if (!Number.isInteger(steamAppId) || steamAppId <= 0) {
      throw new Error(`steam_app_id must be your game's numeric Steam App ID (got '${meta.steam_app_id}')`);
    }
  }
  const icon = [join(dir, 'icon.png'), join(dir, 'assets', 'icon.png')].find((p) => existsSync(p)) ?? null;
  return {
    dir, title, steamAppId, icon,
    appId: meta.app_id?.trim() || defaultAppId(title),
    ...(meta.author ? { author: meta.author } : {}),
    ...(meta.version ? { version: meta.version } : {}),
  };
}

/** Codes of the game's translations (lang/fr.po → fr). */
function translationLanguages(dir: string): string[] {
  const lang = join(dir, 'lang');
  return existsSync(lang) ? readdirSync(lang).filter((f) => /\.(po|csv)$/i.test(f)).map((f) => f.replace(/\.(po|csv)$/i, '')) : [];
}

export async function runExport(a: ExportArgs, log: (msg: string) => void): Promise<string[]> {
  // Loaded only when needed: the desktop exporter pulls in Electron's packager.
  const mobile = await import('@emaki/mobile');
  const info = gameInfo(a.game, mobile.defaultAppId);
  const exportDir = join(info.dir, 'export');
  const webDir = join(exportDir, 'web');

  log(`Building ${info.title} for the web…`);
  await buildWeb(info.dir, webDir, { quiet: true });
  if (a.target === 'web') {
    return [`Web build: ${webDir}`, 'Zip the folder and upload it to itch.io as an HTML game, or put it on any web host.'];
  }

  if (a.target === 'desktop') {
    const { exportDesktop } = await import('@emaki/desktop');
    const platform = (a.platform ?? process.platform) as 'win32' | 'darwin' | 'linux';
    if (!['win32', 'darwin', 'linux'].includes(platform)) throw new Error(`--platform must be win32, darwin or linux (got '${platform}')`);
    const arch = (a.arch ?? (process.arch === 'arm64' ? 'arm64' : 'x64')) as 'x64' | 'arm64';
    if (arch !== 'x64' && arch !== 'arm64') throw new Error(`--arch must be x64 or arm64 (got '${arch}')`);
    const out = await exportDesktop({
      webDir, outDir: join(exportDir, 'desktop'), title: info.title, appId: info.appId, steamAppId: info.steamAppId,
      iconPng: info.icon, platform, arch, log, languages: translationLanguages(info.dir),
      ...(info.author ? { author: info.author } : {}), ...(info.version ? { version: info.version } : {}),
    });
    const notes = [`Desktop app: ${out}`];
    if (platform === 'darwin') notes.push('macOS apps must be signed and notarized before other people can open them without warnings (see docs/exporting.md).');
    if (info.steamAppId) notes.push(`Steam: upload this folder as a depot of App ${info.steamAppId}. Achievements use the ids from your story's 'achievement' lines.`);
    if (!info.icon) notes.push('Tip: put a square icon.png (512x512) in the game folder to give the app its own icon.');
    return notes;
  }

  const r = await mobile.exportMobile({
    webDir, projectDir: join(exportDir, 'mobile'), platform: a.target, title: info.title, appId: info.appId,
    build: !a.noBuild, log, ...(info.version ? { version: info.version } : {}),
  });
  const defaultId = info.appId.startsWith('com.emaki.') ? ` (app id ${info.appId}: set app_id in the story header to your own before publishing)` : '';
  return [
    `${a.target === 'android' ? 'Android' : 'iOS'} project: ${r.projectDir}${defaultId}`,
    ...(r.apk ? [`APK: ${r.apk}`] : []),
    ...r.nextSteps,
  ];
}
