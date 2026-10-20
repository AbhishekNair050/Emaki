/**
 * The game's assets folder, as the editor's asset browser sees it.
 *
 * Lists images and audio, and adds files the writer drops in. New files go
 * into `images/` or `audio/`; a file is never overwritten: the same name with
 * different content gets a numbered copy, identical content is reused.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export type AssetKind = 'image' | 'audio';

export interface AssetInfo {
  /** Path relative to the assets folder, with `/` (what `image x = "..."` uses). */
  path: string;
  kind: AssetKind;
  size: number;
}

export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'];
export const AUDIO_EXT = ['mp3', 'ogg', 'wav', 'm4a', 'opus', 'flac'];
export const MAX_ASSET_BYTES = 100 * 1024 * 1024;

export function kindOf(file: string): AssetKind | null {
  const ext = /\.([^./\\]+)$/.exec(file)?.[1]?.toLowerCase() ?? '';
  return IMAGE_EXT.includes(ext) ? 'image' : AUDIO_EXT.includes(ext) ? 'audio' : null;
}

export class AssetStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  list(): AssetInfo[] {
    const out: AssetInfo[] = [];
    const visit = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) { visit(full); continue; }
        const kind = kindOf(e.name);
        if (kind) out.push({ path: relative(this.root, full).split(sep).join('/'), kind, size: statSync(full).size });
      }
    };
    visit(this.root);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Save a dropped file. Returns where it ended up. */
  add(fileName: string, data: Uint8Array): AssetInfo {
    const kind = kindOf(fileName);
    if (!kind) throw new AssetError(`'${fileName}' isn't an image or audio file Emaki can use (${[...IMAGE_EXT, ...AUDIO_EXT].join(', ')}).`);
    if (data.byteLength > MAX_ASSET_BYTES) throw new AssetError(`'${fileName}' is larger than ${MAX_ASSET_BYTES / 1024 / 1024} MB.`);
    const folder = kind === 'image' ? 'images' : 'audio';
    const clean = safeName(fileName);
    const dot = clean.lastIndexOf('.');
    const stem = clean.slice(0, dot);
    const ext = clean.slice(dot);
    mkdirSync(join(this.root, folder), { recursive: true });
    for (let n = 1; ; n++) {
      const name = n === 1 ? clean : `${stem}-${n}${ext}`;
      const full = join(this.root, folder, name);
      if (existsSync(full)) {
        if (sameBytes(readFileSync(full), data)) return this.info(full, kind);
        continue;
      }
      const tmp = `${full}.saving`;
      writeFileSync(tmp, data);
      renameSync(tmp, full);
      return this.info(full, kind);
    }
  }

  private info(full: string, kind: AssetKind): AssetInfo {
    return { path: relative(this.root, full).split(sep).join('/'), kind, size: statSync(full).size };
  }
}

export class AssetError extends Error {}

/** Keep only the file's own name, made safe for every OS and for URLs. */
export function safeName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 80) || 'file';
  return `${stem}.${ext}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}
