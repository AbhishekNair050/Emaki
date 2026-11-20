import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * npm links the engine's packages (node_modules/@emaki/x → packages/x), and the engine relies on it: its packages
 * import each other by name, and find their files relative to where they really are. Installers copy files and
 * can't carry links, so an installed Studio makes them when it starts: junctions on Windows (no administrator
 * rights needed), symlinks elsewhere. Links already in place are kept. Returns the links it made.
 */
export function linkPackages(root: string): string[] {
  const made: string[] = [];
  const packages = join(root, 'packages');
  for (const dir of readdirSync(packages)) {
    const target = join(packages, dir);
    const manifest = join(target, 'package.json');
    if (!existsSync(manifest)) continue;
    const name: unknown = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name;
    if (typeof name !== 'string' || !/^@emaki\/[\w.-]+$/.test(name)) continue;
    const link = join(root, 'node_modules', ...name.split('/'));
    let stat;
    try { stat = lstatSync(link); } catch { stat = null; }
    if (stat) {
      if (!stat.isSymbolicLink()) continue; // a real folder: not ours to replace
      if (existsSync(link) && realpathSync(link) === realpathSync(target)) continue;
      // A link to somewhere else (an older install's folder): remove only the link.
      try { unlinkSync(link); } catch { rmdirSync(link); }
    }
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link, 'junction');
    made.push(link);
  }
  return made;
}
