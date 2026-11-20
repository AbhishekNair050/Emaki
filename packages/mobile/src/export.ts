/**
 * Phone export: wraps a game's web build in a Capacitor app for Android and iOS.
 *
 * The native projects live in <game>/export/mobile and are kept between
 * exports: the first export creates them, later ones only refresh the game
 * inside (`cap sync`), so changes made in Android Studio or Xcode (signing,
 * icons, store settings) survive. Building the APK needs the Android SDK; iOS
 * needs a Mac with Xcode. Without them the project is still prepared, with
 * instructions for the last step.
 *
 * Which way up the app turns (header `orientation:`) is written into the native
 * projects on every export: the activity's screenOrientation on Android, the
 * supported orientations in Info.plist on iOS.
 */
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Versions of Capacitor the generated projects use (kept in step with each other). */
export const CAPACITOR = {
  core: '^8.6.2',
  cli: '^8.6.2',
  android: '^8.6.2',
  ios: '^8.6.2',
  app: '^8.1.2',
  statusBar: '^8.0.2',
};

export type MobilePlatform = 'android' | 'ios';
/** Which way up the app can be held (the story header's `orientation:`). */
export type AppOrientation = 'landscape' | 'portrait' | 'any';

export interface MobileExportOptions {
  webDir: string;
  /** The Capacitor project folder (created if missing, reused otherwise). */
  projectDir: string;
  platform: MobilePlatform;
  title: string;
  /** Reverse-domain id, e.g. com.studio.gullwing. */
  appId: string;
  version?: string;
  /** Which way up the app turns; `any` (the default) follows the phone. */
  orientation?: AppOrientation;
  /** Build an installable debug APK if the Android SDK is available. */
  build?: boolean;
  log?: (msg: string) => void;
}

export interface MobileExportResult {
  projectDir: string;
  /** The debug APK, when one was built. */
  apk: string | null;
  /** What the developer still has to do, if anything. */
  nextSteps: string[];
}

export async function exportMobile(o: MobileExportOptions): Promise<MobileExportResult> {
  const log = o.log ?? (() => {});
  const dir = o.projectDir;
  mkdirSync(dir, { recursive: true });
  const nextSteps: string[] = [];

  if (!isAppId(o.appId)) {
    throw new Error(`'${o.appId}' isn't a valid app id. Use reverse-domain form, like com.yourstudio.yourgame (letters, digits and _, at least two parts).`);
  }

  // package.json and capacitor.config.json are ours: rewritten every time.
  const pkgPath = join(dir, 'package.json');
  const oldPkg = existsSync(pkgPath) ? readFileSync(pkgPath, 'utf8') : '';
  const pkg = JSON.stringify({
    name: o.appId.split('.').pop()!.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    version: semver(o.version),
    private: true,
    description: `${o.title} (made with Emaki)`,
    dependencies: {
      '@capacitor/core': CAPACITOR.core,
      '@capacitor/android': CAPACITOR.android,
      '@capacitor/ios': CAPACITOR.ios,
      '@capacitor/app': CAPACITOR.app,
      '@capacitor/status-bar': CAPACITOR.statusBar,
      // A regular dependency: the project needs it to build, whatever NODE_ENV says.
      '@capacitor/cli': CAPACITOR.cli,
    },
  }, null, 2) + '\n';
  writeFileSync(pkgPath, pkg);
  writeFileSync(join(dir, 'capacitor.config.json'), JSON.stringify(capacitorConfig(o), null, 2) + '\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\nwww/\n');

  // The game itself.
  rmSync(join(dir, 'www'), { recursive: true, force: true });
  cpSync(o.webDir, join(dir, 'www'), { recursive: true });

  if (!existsSync(join(dir, 'node_modules', '@capacitor', 'cli')) || oldPkg !== pkg) {
    log('Installing Capacitor (first export only)…');
    run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir);
  }

  const platformDir = join(dir, o.platform);
  if (o.platform === 'ios' && process.platform !== 'darwin') {
    nextSteps.push('iOS apps can only be built on a Mac with Xcode. Copy this folder to a Mac and run: npx cap add ios && npx cap open ios');
    return { projectDir: dir, apk: null, nextSteps };
  }
  if (!existsSync(platformDir)) {
    log(`Creating the ${o.platform === 'android' ? 'Android' : 'iOS'} project…`);
    run('npx', ['cap', 'add', o.platform], dir);
  }
  log('Copying the game into the app…');
  run('npx', ['cap', 'sync', o.platform], dir);
  setOrientation(platformDir, o.platform, o.orientation ?? 'any', nextSteps);

  if (o.platform === 'ios') {
    nextSteps.push(`Open it in Xcode to run and publish: cd "${dir}" && npx cap open ios`);
    return { projectDir: dir, apk: null, nextSteps };
  }

  const sdk = androidSdk();
  if (!o.build) {
    nextSteps.push(`Open it in Android Studio to run and publish: cd "${dir}" && npx cap open android`);
    return { projectDir: dir, apk: null, nextSteps };
  }
  if (!sdk) {
    nextSteps.push(
      'To build the APK, install Android Studio (it includes the Android SDK), then export again,',
      `or open the project in Android Studio: cd "${dir}" && npx cap open android`,
    );
    return { projectDir: dir, apk: null, nextSteps };
  }
  const java = findJava();
  if (!java) {
    nextSteps.push(
      `To build the APK, install Java ${JAVA_NEEDED} or newer (a JDK, such as Eclipse Temurin ${JAVA_NEEDED}) and set JAVA_HOME to it, then export again.`,
      `Android Studio comes with one, so you can also build it there: cd "${dir}" && npx cap open android`,
    );
    return { projectDir: dir, apk: null, nextSteps };
  }
  log('Building the debug APK with Gradle (the first build downloads a lot)…');
  // By its full path: Windows may be set not to run programs from the current folder (NoDefaultCurrentDirectoryInExePath).
  const gradlew = join(platformDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  run(gradlew, ['assembleDebug', '--quiet'], platformDir, { ANDROID_HOME: sdk, ...(java.home ? { JAVA_HOME: java.home } : {}) });
  const built = join(platformDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!existsSync(built)) throw new Error('Gradle finished but no APK was produced.');
  const apk = join(dir, `${fileName(o.title)}-debug.apk`);
  cpSync(built, apk);
  nextSteps.push('This is a debug build for testing (install it with: adb install -r "' + apk + '").',
    'For Google Play, open the project in Android Studio and use Build > Generate Signed App Bundle.');
  return { projectDir: dir, apk, nextSteps };
}

/** Write the orientation into the native project, wherever the generated files are. */
function setOrientation(platformDir: string, platform: MobilePlatform, orientation: AppOrientation, nextSteps: string[]): void {
  const file = platform === 'android'
    ? join(platformDir, 'app', 'src', 'main', 'AndroidManifest.xml')
    : join(platformDir, 'App', 'App', 'Info.plist');
  if (!existsSync(file)) return;
  const before = readFileSync(file, 'utf8');
  const after = platform === 'android' ? withAndroidOrientation(before, orientation) : withIosOrientation(before, orientation);
  if (after === null) {
    nextSteps.push(`Couldn't find the main activity in ${file}: set its screen orientation (${orientation}) in Android Studio.`);
    return;
  }
  if (after !== before) writeFileSync(file, after);
}

const ANDROID_ORIENTATION = { landscape: 'sensorLandscape', portrait: 'sensorPortrait' } as const;

/**
 * The manifest with the main activity turning only `orientation` ways up (both landscapes, or both portraits), or
 * free to turn for `any`. Null when there is no main activity to change.
 */
export function withAndroidOrientation(manifest: string, orientation: AppOrientation): string | null {
  let found = false;
  const next = manifest.replace(/<activity\s[^>]*>/g, (tag) => {
    if (!/android:name="[^"]*\.MainActivity"/.test(tag)) return tag;
    found = true;
    const plain = tag.replace(/\s+android:screenOrientation="[^"]*"/, '');
    return orientation === 'any' ? plain : plain.replace(/^<activity/, `<activity android:screenOrientation="${ANDROID_ORIENTATION[orientation]}"`);
  });
  return found ? next : null;
}

const IOS_ORIENTATIONS: Record<AppOrientation, { phone: string[]; pad: string[] }> = {
  landscape: {
    phone: ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'],
    pad: ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'],
  },
  portrait: {
    phone: ['UIInterfaceOrientationPortrait'],
    pad: ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown'],
  },
  any: {
    phone: ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'],
    pad: ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'],
  },
};

/**
 * Info.plist with the orientations the app supports on iPhone and iPad. An iPad app that doesn't turn every way
 * must also ask for the whole screen (no Split View), or the App Store refuses it.
 */
export function withIosOrientation(plist: string, orientation: AppOrientation): string {
  const { phone, pad } = IOS_ORIENTATIONS[orientation];
  let next = plist;
  // Keys are plain words (and ~), so they can go into a pattern as they are.
  const set = (key: string, xml: string) => {
    const existing = new RegExp(`(<key>${key}</key>\\s*)(<array>[\\s\\S]*?</array>|<true/>|<false/>)`);
    if (existing.test(next)) next = next.replace(existing, (_m, head: string) => head + xml);
    else next = next.replace(/\n?<\/dict>(\s*<\/plist>\s*)$/, (_m, tail: string) => `\n\t<key>${key}</key>\n\t${xml}\n</dict>${tail}`);
  };
  const array = (list: string[]) => `<array>\n${list.map((v) => `\t\t<string>${v}</string>`).join('\n')}\n\t</array>`;
  set('UISupportedInterfaceOrientations', array(phone));
  set('UISupportedInterfaceOrientations~ipad', array(pad));
  if (orientation !== 'any') set('UIRequiresFullScreen', '<true/>');
  return next;
}

export function capacitorConfig(o: Pick<MobileExportOptions, 'appId' | 'title'>) {
  return {
    appId: o.appId,
    appName: o.title,
    webDir: 'www',
    backgroundColor: '#000000',
    android: { allowMixedContent: false, captureInput: true },
    ios: { contentInset: 'never', scrollEnabled: false },
    plugins: { StatusBar: { overlaysWebView: true, style: 'DARK' } },
  };
}

/** Reverse-domain id that Android and iOS both accept. */
export function isAppId(id: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(id);
}

/** com.emaki.<title> when a game doesn't set app_id. */
export function defaultAppId(title: string): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').replace(/^\d+/, '') || 'game';
  return `com.emaki.${slug.slice(0, 40)}`;
}

/** npm and the app stores want x.y.z. */
export function semver(v: string | undefined): string {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v ?? '');
  return m ? `${m[1]}.${m[2] ?? 0}.${m[3] ?? 0}` : '1.0.0';
}

function fileName(title: string): string {
  return title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';
}

/** The Java the generated Android projects compile with (Capacitor 8). */
export const JAVA_NEEDED = 21;

/** The major version in `java -version` output ("17.0.11", "21", "1.8.0_402" → 8), or null. */
export function javaMajor(versionOutput: string): number | null {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(versionOutput);
  if (!m) return null;
  const first = Number(m[1]);
  return first === 1 && m[2] ? Number(m[2]) : first;
}

/**
 * A Java new enough for Gradle: JAVA_HOME, then the one Android Studio comes with, then `java` on the PATH.
 * `home` is what to give Gradle as JAVA_HOME (none for the PATH's java, which Gradle finds itself).
 */
function findJava(): { home: string | null } | null {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const studio = [
    process.platform === 'win32' && process.env.ProgramFiles ? join(process.env.ProgramFiles, 'Android', 'Android Studio', 'jbr') : undefined,
    process.platform === 'darwin' ? '/Applications/Android Studio.app/Contents/jbr/Contents/Home' : undefined,
    process.platform === 'linux' ? '/opt/android-studio/jbr' : undefined,
  ];
  // `java -version` writes to stderr.
  const versionOf = (cmd: string) => {
    const r = spawnSync(cmd, ['-version'], { encoding: 'utf8' });
    return r.error ? null : javaMajor(`${r.stderr ?? ''}${r.stdout ?? ''}`);
  };
  for (const home of [process.env.JAVA_HOME, ...studio]) {
    if (!home || !existsSync(join(home, 'bin', exe))) continue;
    if ((versionOf(join(home, 'bin', exe)) ?? 0) >= JAVA_NEEDED) return { home };
  }
  return (versionOf('java') ?? 0) >= JAVA_NEEDED ? { home: null } : null;
}

/** The Android SDK, if installed. */
export function androidSdk(): string | null {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : undefined,
    process.platform === 'darwin' && process.env.HOME ? join(process.env.HOME, 'Library', 'Android', 'sdk') : undefined,
    process.platform === 'linux' && process.env.HOME ? join(process.env.HOME, 'Android', 'Sdk') : undefined,
  ];
  return candidates.find((p): p is string => !!p && existsSync(p)) ?? null;
}

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): void {
  // Building the web game set NODE_ENV=production in this process; it would make npm skip packages.
  const inherited: NodeJS.ProcessEnv = { ...process.env };
  delete inherited.NODE_ENV;
  const opts = { cwd, stdio: 'inherit' as const, env: { ...inherited, ...env } };
  // npm, npx and gradlew.bat are batch files on Windows, which only a shell can run.
  if (process.platform === 'win32') execSync([cmd, ...args].map(quote).join(' '), opts);
  else execFileSync(cmd, args, opts);
}

function quote(a: string): string {
  return /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
}
