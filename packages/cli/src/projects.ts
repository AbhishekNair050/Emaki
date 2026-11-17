/** Launcher preferences contain paths only; game files stay in their own folders. */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { newGame } from './new.ts';
import { parse } from '@emaki/format';

export interface Project { path: string; title: string; available: boolean; lastOpened: string }
interface Recent { path: string; lastOpened: string }
export const DEFAULT_PROJECTS_DIR = join(homedir(), 'Emaki Projects');

/** Accept a game folder or its story.vn; real paths prevent duplicate symlink/case entries. */
export function projectPath(input: string): string {
  let path = resolve(input);
  if (basename(path).toLowerCase() === 'story.vn' && existsSync(path) && statSync(path).isFile()) path = dirname(path);
  if (!existsSync(join(path, 'story.vn')) || !statSync(join(path, 'story.vn')).isFile()) {
    throw new Error('This folder has no story.vn. Select the game folder containing that file.');
  }
  return realpathSync.native(path);
}

function project(recent: Recent): Project {
  let title = basename(recent.path);
  let available = false;
  try {
    // Recent-project polling should not read a full-length novel every two seconds.
    const fd = openSync(join(recent.path, 'story.vn'), 'r');
    const buffer = Buffer.alloc(16_384);
    let source: string;
    try { source = buffer.subarray(0, readSync(fd, buffer)).toString('utf8'); } finally { closeSync(fd); }
    const header = /^\s*---\r?\n[\s\S]*?\r?\n---/.exec(source)?.[0];
    const value = header && parse(header).program.meta.find(([key]) => key === 'title')?.[1];
    if (value) title = value;
    available = true;
  } catch { /* Keep moved/missing projects visible so the writer can locate or remove them. */ }
  return { ...recent, title, available };
}

export class Projects {
  readonly file: string;
  private recent: Recent[];

  constructor(file = process.env.EMAKI_LAUNCHER_STATE ?? join(homedir(), '.emaki', 'launcher.json')) {
    this.file = file;
    this.recent = [];
    if (!existsSync(file)) return;
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!raw || typeof raw !== 'object' || !('projects' in raw) || !Array.isArray(raw.projects)) throw new Error('Invalid project list');
      this.recent = raw.projects.filter((p: unknown): p is Recent => !!p && typeof p === 'object'
        && 'path' in p && typeof p.path === 'string' && 'lastOpened' in p && typeof p.lastOpened === 'string').slice(0, 50);
    } catch {
      // Preserve the original, rather than silently overwriting a damaged preferences file.
      throw new Error(`Could not read the launcher project list at ${file}. Move it aside and start the launcher again. Your games are unaffected.`);
    }
  }

  list(): Project[] { return this.recent.map(project); }

  add(input: string): Project {
    const path = projectPath(input);
    const entry = { path, lastOpened: new Date().toISOString() };
    this.persist([entry, ...this.recent.filter((p) => p.path !== path)].slice(0, 50));
    return project(entry);
  }

  remove(path: string): void { this.persist(this.recent.filter((p) => p.path !== path)); }

  create(parent: string, folder: string, title: string): Project {
    if (!title.trim() || title.length > 200 || /[\r\n\u0000-\u001f]/.test(title)) throw new Error('Enter a game title on one line (up to 200 characters).');
    if (!folder || folder.length > 100 || !/^[\p{L}\p{N}_ -]+$/u.test(folder) || /[. ]$/.test(folder)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(folder)) {
      throw new Error('Use a folder name with letters, numbers, spaces, hyphens or underscores.');
    }
    const path = join(resolve(parent), folder);
    // Create only a new directory: never adopt or write over an existing folder.
    if (existsSync(path)) throw new Error('That folder already exists. Choose a new folder name, or open the existing game.');
    newGame(path, title.trim());
    return this.add(path);
  }

  private persist(next: Recent[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, projects: next }, null, 2) + '\n');
    renameSync(tmp, this.file);
    this.recent = next;
  }
}
