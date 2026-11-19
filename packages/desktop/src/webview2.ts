import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pngToIco } from './icon.ts';
import type { DesktopExportOptions } from './export.ts';
import { windowShape } from './window.ts';

const run = promisify(execFile);
const sources = resolve(import.meta.dirname, '../webview2');
const libraries = ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll'];

/** The WebView2 SDK every export builds with and ships to players, and the SHA-512 NuGet publishes for its package. */
export interface SdkPin { version: string; sha512: string }
export const WEBVIEW2_SDK: SdkPin = {
  version: '1.0.2903.40',
  sha512: 'pDLSrpyma3xyOGXlw3Aowy7XceBdeJbukZzKLVdPCFvyfnn8PrCLylMn6c456ja0TcOOal8IdQCVONDRU2OGkw==',
};

/** A Windows DLL's version from its VS_FIXEDFILEINFO (e.g. "1.0.2903.40"), or null without one. */
export function fileVersion(data: Uint8Array): string | null {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  // The version resource sits near the end of the file, in .rsrc.
  const at = bytes.lastIndexOf(Buffer.from([0xbd, 0x04, 0xef, 0xfe]));
  if (at < 0 || at + 16 > bytes.length) return null;
  const high = bytes.readUInt32LE(at + 8), low = bytes.readUInt32LE(at + 12);
  return [high >>> 16, high & 0xffff, low >>> 16, low & 0xffff].join('.');
}

/**
 * The SDK files to compile against and ship, from an extracted package (or a
 * folder holding the three DLLs and the license). Every source is checked:
 * the DLLs must be the pinned version, and Microsoft's license goes with them.
 */
async function sdkFiles(root: string, pin: SdkPin): Promise<string[]> {
  const dirs = ['lib/net462', 'lib/net462', 'runtimes/win-x64/native'];
  const files = libraries.map((name, i) => {
    const sdkFile = join(root, dirs[i]!, name);
    return existsSync(sdkFile) ? sdkFile : join(root, name);
  });
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`Missing WebView2 SDK file: ${file}`);
    const version = fileVersion(await readFile(file));
    if (version !== pin.version) {
      throw new Error(`${file} is WebView2 SDK ${version ?? 'of an unknown version'}, but Emaki builds with ${pin.version}. Point EMAKI_WEBVIEW2_SDK at the extracted Microsoft.Web.WebView2 ${pin.version} package, or unset it to download that version.`);
    }
  }
  const notices = (await readdir(root)).filter(name => /^(license|notice)(\..*)?$/i.test(name));
  if (!notices.some(name => /^license/i.test(name))) {
    throw new Error(`The WebView2 SDK in ${root} has no LICENSE.txt. Use the extracted Microsoft.Web.WebView2 ${pin.version} package: its license must ship with the DLLs.`);
  }
  return [...files, ...notices.map(name => join(root, name))];
}

export async function resolveWebView2Sdk(work: string, log: (message: string) => void, pin: SdkPin = WEBVIEW2_SDK): Promise<string[]> {
  if (process.env.EMAKI_WEBVIEW2_SDK) return sdkFiles(resolve(process.env.EMAKI_WEBVIEW2_SDK), pin);
  const nuget = process.env.NUGET_PACKAGES || join(homedir(), '.nuget/packages');
  const installed = join(nuget, 'microsoft.web.webview2', pin.version);
  if (existsSync(installed)) return sdkFiles(installed, pin);
  const parent = join(process.env.LOCALAPPDATA || tmpdir(), 'Emaki', 'SDK');
  const cached = join(parent, pin.version);
  if (existsSync(cached)) return sdkFiles(cached, pin);
  const url = `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${pin.version}/microsoft.web.webview2.${pin.version}.nupkg`;
  log(`Downloading Microsoft's WebView2 SDK ${pin.version} (one time)…`);
  let data: ArrayBuffer;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.arrayBuffer();
  } catch (e) {
    throw new Error(`Could not download the WebView2 SDK from NuGet. For offline exports set EMAKI_WEBVIEW2_SDK to the extracted Microsoft.Web.WebView2 ${pin.version} package. ${e instanceof Error ? e.message : e}`);
  }
  // Its DLLs ship inside every game: use the package only if it's exactly the one NuGet published.
  if (createHash('sha512').update(new Uint8Array(data)).digest('base64') !== pin.sha512) {
    throw new Error(`The downloaded WebView2 SDK ${pin.version} doesn't match the SHA-512 NuGet publishes for it, so it wasn't used. Try again, or set EMAKI_WEBVIEW2_SDK to the extracted package.`);
  }
  const archive = join(work, 'sdk.zip');
  await writeFile(archive, new Uint8Array(data));
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, 'extract-'));
  try {
    // The staging directory is empty. The two-path overload is available on
    // .NET Framework, including hosts where Expand-Archive requests a newer overload.
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:EMAKI_ZIP, $env:EMAKI_DEST)"], {
      env: { ...process.env, EMAKI_ZIP: archive, EMAKI_DEST: staging }, windowsHide: true,
    });
    await sdkFiles(staging, pin);
    try { await rename(staging, cached); } catch (err) { if (!existsSync(cached)) throw err; }
  } finally { await rm(staging, { recursive: true, force: true }); }
  return sdkFiles(cached, pin);
}

async function compile(csc: string, args: string[], cwd: string): Promise<void> {
  try { await run(csc, ['/nologo', '/optimize+', ...args], { windowsHide: true, cwd }); }
  catch (err) {
    const failure = err as { stdout?: string; stderr?: string; message: string };
    throw new Error((failure.stdout || failure.stderr || failure.message).trim());
  }
}

export async function exportWebView2(o: DesktopExportOptions, name: string, version: string): Promise<string> {
  const log = o.log ?? (() => {});
  const csc = join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  if (!existsSync(csc)) throw new Error('Windows export requires the .NET Framework 4.x C# compiler. Enable .NET Framework 4.8 or select --shell electron.');
  const output = resolve(o.outDir);
  await mkdir(output, { recursive: true });
  const destination = join(output, name + '-win32-x64-webview2');
  // The OS releases the named pipe on process exit. Independent games can export concurrently.
  const lock = createServer(socket => socket.destroy());
  const token = createHash('sha256').update(destination.toLowerCase()).digest('hex');
  await new Promise<void>((ok, fail) => {
    lock.once('error', (err: NodeJS.ErrnoException) => fail(err.code === 'EADDRINUSE'
      ? new Error(`${o.title} is already being exported for Windows. Wait for that export to finish.`) : err));
    lock.listen('\\\\.\\pipe\\emaki-export-' + token, ok);
  });
  let work: string | undefined;
  try {
    work = await mkdtemp(join(output, '.webview2-'));
    const app = join(work, 'app');
    await mkdir(app);
    const sdk = await resolveWebView2Sdk(work, log);
    for (const file of sdk) await copyFile(file, join(app, file.split(/[\\/]/).pop()!));
    const packer = join(work, 'pack.exe'), key = join(work, 'key');
    await writeFile(key, randomBytes(64));
    await compile(csc, ['/target:exe', '/out:pack.exe', join(sources, 'Pack.cs'), join(sources, 'PackWriter.cs')], work);
    log('Encrypting game files…');
    try { await run(packer, [resolve(o.webDir), join(app, 'game.emaki'), key], { windowsHide: true }); }
    catch (e) { throw new Error((e as { stderr?: string }).stderr?.trim() || String(e)); }
    const metadata = join(work, 'game.json');
    // Title, app id, product name, then the window's shape (see window.ts) as text: the player reads a string array.
    const shape = windowShape(o.aspect);
    await writeFile(metadata, JSON.stringify([o.title, o.appId, name,
      ...[shape.width, shape.height, shape.minWidth, shape.minHeight].map(String)]));
    await copyFile(join(sources, 'bridge.js'), join(work, 'bridge.js'));
    // Assembly metadata uses C# regular string literals. Escape every UTF-16
    // unit so game titles, including quotes and line separators, stay data.
    const literal = (s: string) => '"' + s.split('').map(ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '"';
    const info = join(work, 'AssemblyInfo.cs');
    const assemblyVersion = version.split('.').map(n => Math.min(65534, Number(n))).join('.');
    await writeFile(info, 'using System.Reflection;\n' + Object.entries({
      AssemblyTitle: o.title, AssemblyProduct: name, AssemblyCompany: o.author || name,
      AssemblyVersion: assemblyVersion, AssemblyInformationalVersion: o.version || version,
    }).map(([k, v]) => `[assembly: ${k}(${literal(v)})]`).join('\n'));
    // The manifest makes the player follow each monitor's scaling, as Electron
    // does; without it Windows stretches the window and the game looks blurry.
    const args = ['/target:winexe', '/platform:x64', '/out:' + join(app, name + '.exe'), '/win32manifest:' + join(sources, 'player.manifest'),
      '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.dll', '/r:System.Web.Extensions.dll',
      ...libraries.slice(0, 2).map(f => '/r:app/' + f), '/resource:key,key', '/resource:game.json,game.json',
      '/resource:bridge.js,bridge.js', info,
      ...['Pack.cs', 'Resource.cs', 'Profile.cs', 'Player.cs'].map(f => join(sources, f))];
    if (o.iconPng) {
      const icon = join(work, 'game.ico');
      await writeFile(icon, pngToIco(await readFile(o.iconPng)));
      args.push('/win32icon:' + icon);
    }
    await compile(csc, args, work);
    const previous = join(work, 'previous');
    const replacing = existsSync(destination);
    if (replacing) {
      try { await rename(destination, previous); }
      catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw err;
        throw new Error(`Could not replace ${destination}: a file in it is in use. Close the game if it's running (and any window showing that folder), then export again.`);
      }
    }
    try { await rename(app, destination); }
    catch (err) {
      if (replacing) {
        try { await rename(previous, destination); }
        catch { work = undefined; throw new Error(`Could not replace the running game. Previous export preserved at ${previous}`); }
      }
      throw err;
    }
    log(`Encrypted pack: ${((await stat(join(destination, 'game.emaki'))).size / 1048576).toFixed(1)} MiB`);
    return destination;
  } finally {
    lock.close();
    if (work) await rm(work, { recursive: true, force: true });
  }
}
