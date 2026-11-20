import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { desktopShell } from '../src/export.ts';
import { fileVersion, resolveWebView2Sdk } from '../src/webview2.ts';

it('selects the Windows player only for supported local exports and preserves explicit Electron and Steam builds', () => {
  expect(desktopShell('win32', 'x64', null, undefined, 'win32')).toBe('webview2');
  expect(desktopShell('win32', 'x64', null, 'electron', 'win32')).toBe('electron');
  for (const [platform, arch, steam, host] of [
    ['linux', 'x64', null, 'win32'], ['win32', 'arm64', null, 'win32'], ['win32', 'x64', 480, 'win32'],
    ['win32', 'x64', null, 'linux'],
  ] as const) {
    expect(desktopShell(platform, arch, steam, undefined, host)).toBe('electron');
    expect(() => desktopShell(platform, arch, steam, 'webview2', host)).toThrow();
  }
  expect(() => desktopShell('win32', 'x64', null, 'invalid', 'win32')).toThrow();
});

it.runIf(process.platform === 'win32')('reads authenticated packs and serves exact HTTP byte ranges', () => {
  const work = mkdtempSync(join(tmpdir(), 'emaki-pack-test-'));
  try {
    const csc = join(process.env.SystemRoot!, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const exe = join(work, 'test.exe');
    const source = resolve(import.meta.dirname, '../webview2');
    execFileSync(csc, ['/nologo', '/main:PackTests', '/out:' + exe, '/r:System.Web.dll',
      ...['Pack.cs', 'PackWriter.cs', 'Resource.cs', 'Profile.cs'].map(f => join(source, f)), join(import.meta.dirname, 'PackTests.cs')]);
    expect(execFileSync(exe, [work], { encoding: 'utf8' })).toContain('checks passed');
  } finally { rmSync(work, { recursive: true, force: true }); }
}, 20000);

/** A stand-in DLL: some bytes, then a VS_FIXEDFILEINFO with the given version. */
function fakeDll(text: string, version: string): Buffer {
  const [a, b, c, d] = version.split('.').map(Number) as [number, number, number, number];
  const info = Buffer.alloc(16);
  info.writeUInt32LE(0xfeef04bd, 0);
  info.writeUInt32LE(0x00010000, 4);
  info.writeUInt32LE(((a << 16) | b) >>> 0, 8);
  info.writeUInt32LE(((c << 16) | d) >>> 0, 12);
  return Buffer.concat([Buffer.from(text), info, Buffer.alloc(32)]);
}

const SDK_ENTRIES = [
  'lib/net462/Microsoft.Web.WebView2.Core.dll',
  'lib/net462/Microsoft.Web.WebView2.WinForms.dll',
  'runtimes/win-x64/native/WebView2Loader.dll',
  'LICENSE.txt',
];

/** An extracted SDK package in `dir`, with the DLLs at `version`. */
function fakeSdk(dir: string, version: string, entries = SDK_ENTRIES): void {
  for (const path of entries) {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, path.endsWith('.dll') ? fakeDll(path, version) : path);
  }
}

it('reads the version a Windows DLL carries', () => {
  expect(fileVersion(fakeDll('MZ...', '1.0.2903.40'))).toBe('1.0.2903.40');
  expect(fileVersion(fakeDll('MZ...', '65535.2.3.65535'))).toBe('65535.2.3.65535');
  expect(fileVersion(Buffer.from('no version here'))).toBeNull();
});

it.runIf(process.platform === 'win32')('downloads the SDK only when it matches the published hash, and reuses the checked cache', async () => {
  const work = mkdtempSync(join(tmpdir(), 'emaki sdk [test]-'));
  try {
    const contents = join(work, 'package');
    const archive = join(work, 'fixture.nupkg');
    fakeSdk(contents, '9.8.7.6');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:EMAKI_FIXTURE, $env:EMAKI_ARCHIVE)'], {
      env: { ...process.env, EMAKI_FIXTURE: contents, EMAKI_ARCHIVE: archive }, windowsHide: true,
    });
    const bytes = readFileSync(archive);
    const pin = { version: '9.8.7.6', sha512: createHash('sha512').update(bytes).digest('base64') };
    vi.stubEnv('EMAKI_WEBVIEW2_SDK', '');
    vi.stubEnv('NUGET_PACKAGES', join(work, 'nuget'));
    vi.stubEnv('LOCALAPPDATA', join(work, 'local'));
    const fetchSdk = vi.fn(() => new Response(new Uint8Array(bytes)));
    vi.stubGlobal('fetch', fetchSdk);

    // A package that isn't the published one is never extracted or cached.
    // The archive's hash changes with every run (zip timestamps), so change its first character to one it isn't.
    const wrong = (pin.sha512[0] === 'A' ? 'B' : 'A') + pin.sha512.slice(1);
    await expect(resolveWebView2Sdk(work, () => {}, { ...pin, sha512: wrong })).rejects.toThrow(/SHA-512/);
    expect(existsSync(join(work, 'local', 'Emaki', 'SDK', pin.version))).toBe(false);

    const first = await resolveWebView2Sdk(work, () => {}, pin);
    expect(first.map(file => basename(file))).toEqual(SDK_ENTRIES.map(path => basename(path)));
    expect(await resolveWebView2Sdk(work, () => {}, pin)).toEqual(first);
    expect(fetchSdk).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(work, { recursive: true, force: true });
  }
}, 20000);

it('ships only the pinned SDK version, with its license', async () => {
  const work = mkdtempSync(join(tmpdir(), 'emaki-sdk-pin-'));
  const pin = { version: '1.0.2903.40', sha512: '' };
  try {
    const older = join(work, 'older');
    fakeSdk(older, '1.0.2365.46');
    vi.stubEnv('EMAKI_WEBVIEW2_SDK', older);
    await expect(resolveWebView2Sdk(work, () => {}, pin)).rejects.toThrow(/1\.0\.2365\.46.*1\.0\.2903\.40/);

    const unlicensed = join(work, 'unlicensed');
    fakeSdk(unlicensed, pin.version, SDK_ENTRIES.filter(path => path !== 'LICENSE.txt'));
    vi.stubEnv('EMAKI_WEBVIEW2_SDK', unlicensed);
    await expect(resolveWebView2Sdk(work, () => {}, pin)).rejects.toThrow(/LICENSE/);

    const good = join(work, 'good');
    fakeSdk(good, pin.version);
    vi.stubEnv('EMAKI_WEBVIEW2_SDK', good);
    expect(await resolveWebView2Sdk(work, () => {}, pin)).toHaveLength(4);
  } finally {
    vi.unstubAllEnvs();
    rmSync(work, { recursive: true, force: true });
  }
});

it.runIf(process.platform === 'win32')('pins the SDK that is cached on this machine, if any', async () => {
  const cached = join(process.env.LOCALAPPDATA ?? '', 'Emaki', 'SDK', '1.0.2903.40', 'lib', 'net462', 'Microsoft.Web.WebView2.Core.dll');
  if (!existsSync(cached)) return;
  expect(fileVersion(readFileSync(cached))).toBe('1.0.2903.40');
});

