/**
 * Drives the extension inside a real VS Code, with a throwaway profile so your
 * own settings and extensions are untouched. Not part of CI (it needs a desktop).
 *
 *   VSCODE_PATH="C:/path/to/Code.exe" npm run test:e2e -w emaki-vscode
 *
 * Prints what the extension did (diagnostics, definition, completion, ...).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// A plugin for the game, so `@` lines are checked against its manifest (changed during the run).
mkdirSync(join(work, 'plugins', 'dice'), { recursive: true });
writeFileSync(join(work, 'plugins', 'dice', 'plugin.json'), JSON.stringify({ functions: { roll: { args: { sides: 'number' }, returns: 'number' } } }));
writeFileSync(join(work, 'plugins', 'dice', 'index.js'), 'export default () => ({ functions: { roll: (n = 6) => 1 + Math.floor(Math.random() * n) } });\n');
const report = join(tmp, 'report.txt');

try {
  execFileSync(code, [
    `--extensionDevelopmentPath=${here('../..')}`,
    `--extensionTestsPath=${here('./suite.cjs')}`,
    `--user-data-dir=${join(tmp, 'user')}`,
    `--extensions-dir=${join(tmp, 'extensions')}`,
    '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu',
    work,
  ], { env: { ...process.env, EMAKI_E2E_REPORT: report, EMAKI_E2E_STORY: join(work, 'story.vn'), EMAKI_E2E_PLUGIN: join(work, 'plugins', 'dice', 'plugin.json'), EMAKI_E2E_PREVIEW_URL: process.env.EMAKI_E2E_PREVIEW_URL ?? 'http://localhost:5173/' }, stdio: 'ignore', timeout: 120_000 });
} catch (err) {
  console.error(`VS Code didn't finish: ${err.message.split('\n')[0]}`);
} finally {
  const partial = report + '.partial';
  const out = existsSync(report) ? readFileSync(report, 'utf8')
    : existsSync(partial) ? readFileSync(partial, 'utf8') + '(stopped here)\n' : '';
  console.log(out);
  process.exitCode = !out || out.includes('ERROR') || out.includes('stopped here') ? 1 : 0;
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* VS Code may still hold files */ }
}
