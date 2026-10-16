/**
 * Drives the extension inside a real VS Code, with a throwaway profile so your
 * own settings and extensions are untouched. Not part of CI (it needs a desktop).
 *
 *   VSCODE_PATH="C:/path/to/Code.exe" npm run test:e2e -w emaki-vscode
 *
 * Prints what the extension did (diagnostics, definition, completion, ...).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const code = process.env.VSCODE_PATH;
if (!code) {
  console.error('Set VSCODE_PATH to your VS Code executable (Code.exe, or .../Visual Studio Code.app/Contents/MacOS/Electron).');
  process.exit(1);
}
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'emaki-e2e-'));
const work = join(tmp, 'work');
mkdirSync(work);
copyFileSync(here('../../../../games/gullwing/story.vn'), join(work, 'story.vn')); // edited during the run
const report = join(tmp, 'report.txt');

try {
  execFileSync(code, [
    `--extensionDevelopmentPath=${here('../..')}`,
    `--extensionTestsPath=${here('./suite.cjs')}`,
    `--user-data-dir=${join(tmp, 'user')}`,
    `--extensions-dir=${join(tmp, 'extensions')}`,
    '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu',
    work,
  ], { env: { ...process.env, EMAKI_E2E_REPORT: report, EMAKI_E2E_STORY: join(work, 'story.vn') }, stdio: 'ignore', timeout: 120_000 });
  const out = readFileSync(report, 'utf8');
  console.log(out);
  process.exitCode = out.includes('ERROR') ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
