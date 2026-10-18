/**
 * The script on disk, as the editor sees it.
 *
 * Every read returns a `version` (a hash of the bytes on disk). A save names
 * the version it was based on; if the file changed since (edited in VS Code,
 * pulled from git...), the save is refused and the caller gets the new text,
 * so nobody's work is silently overwritten.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fnv1a } from '@emaki/format';

export interface StoryText {
  /** Script text with `\n` line endings (what the editor works with). */
  text: string;
  version: string;
}

export type SaveResult =
  | { ok: true; version: string }
  | { ok: false; conflict: StoryText };

export class StoryFile {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  read(): StoryText {
    const raw = existsSync(this.path) ? readFileSync(this.path, 'utf8') : '';
    return { text: raw.replace(/\r\n?/g, '\n'), version: versionOf(raw) };
  }

  /** The current version on disk, without the text. */
  version(): string {
    return versionOf(existsSync(this.path) ? readFileSync(this.path, 'utf8') : '');
  }

  /**
   * Save `text` if the file is still at version `base`. Keeps the file's
   * existing line endings (Windows files stay CRLF). Written to a temporary
   * file first and renamed, so a crash never leaves half a script.
   */
  save(text: string, base: string): SaveResult {
    const raw = existsSync(this.path) ? readFileSync(this.path, 'utf8') : '';
    if (versionOf(raw) !== base) return { ok: false, conflict: { text: raw.replace(/\r\n?/g, '\n'), version: versionOf(raw) } };
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const out = text.replace(/\r\n?/g, '\n').replace(/\n/g, eol);
    if (out === raw) return { ok: true, version: base };
    const tmp = `${this.path}.saving`;
    writeFileSync(tmp, out, 'utf8');
    renameSync(tmp, this.path);
    return { ok: true, version: versionOf(out) };
  }
}

export function versionOf(raw: string): string {
  return `${fnv1a(raw)}-${raw.length}`;
}
