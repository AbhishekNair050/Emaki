/**
 * Keeps story.vn on disk in step with the editor.
 *
 * Saves on its own shortly after typing stops (and at once on Ctrl+S). Each
 * save names the version it started from; if someone else changed the file
 * meanwhile (VS Code, git), the server refuses and we ask the writer which
 * version to keep. Changes on disk while there are no unsaved edits are just
 * loaded.
 */

export interface StoryText {
  text: string;
  version: string;
}

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'error';

export interface SyncHooks {
  status(status: SaveStatus, detail?: string): void;
  /** The file changed on disk and there were no unsaved edits: show this text. */
  reload(text: string): void;
  /** The file changed on disk and so did the editor: ask which to keep. */
  conflict(theirs: StoryText): void;
}

export interface SyncOptions {
  url?: string;
  autosaveMs?: number;
  retryMs?: number;
  fetch?: typeof fetch;
}

export class StorySync {
  private readonly hooks: SyncHooks;
  private readonly url: string;
  private readonly autosaveMs: number;
  private readonly retryMs: number;
  private readonly fetch: typeof fetch;

  private version: string;
  private savedText: string;
  private text: string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | null = null;
  private pendingConflict: StoryText | null = null;
  private externalVersion: string | null = null;

  constructor(initial: StoryText, hooks: SyncHooks, opts: SyncOptions = {}) {
    this.hooks = hooks;
    this.url = opts.url ?? '/__emaki/story';
    this.autosaveMs = opts.autosaveMs ?? 800;
    this.retryMs = opts.retryMs ?? 5000;
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.version = initial.version;
    this.savedText = this.text = initial.text;
  }

  get dirty(): boolean {
    return this.text !== this.savedText;
  }

  get conflicted(): boolean {
    return this.pendingConflict !== null;
  }

  /** The editor's text changed. */
  changed(text: string): void {
    this.text = text;
    if (this.pendingConflict) return;
    this.hooks.status(this.dirty ? 'unsaved' : 'saved');
    this.schedule(this.autosaveMs);
  }

  /** Save now (Ctrl+S). Resolves when this save (and any it waited for) is done. */
  async saveNow(): Promise<void> {
    clearTimeout(this.timer);
    while (this.inFlight) await this.inFlight;
    if (this.pendingConflict || !this.dirty) {
      if (!this.pendingConflict) this.hooks.status('saved');
      return this.afterSave();
    }
    const sent = this.text;
    this.hooks.status('saving');
    this.inFlight = this.put(sent).finally(() => { this.inFlight = null; });
    await this.inFlight;
    await this.afterSave();
  }

  /** The server says story.vn changed on disk. */
  async external(version: string): Promise<void> {
    if (version === this.version) return;
    if (this.inFlight) { this.externalVersion = version; return; }
    const theirs = await this.get();
    if (!theirs || theirs.version === this.version) return;
    if (!this.dirty) {
      this.version = theirs.version;
      this.savedText = this.text = theirs.text;
      this.hooks.reload(theirs.text);
      this.hooks.status('saved');
    } else if (theirs.text === this.text) {
      // Someone saved exactly what we have (e.g. the same edit undone elsewhere).
      this.version = theirs.version;
      this.savedText = theirs.text;
      this.hooks.status('saved');
    } else {
      this.raise(theirs);
    }
  }

  /** Conflict resolution: overwrite the file with the editor's text. */
  async keepMine(): Promise<void> {
    const c = this.pendingConflict;
    if (!c) return;
    this.pendingConflict = null;
    this.version = c.version;
    this.savedText = c.text;
    await this.saveNow();
  }

  /** Conflict resolution: drop the editor's changes and load the file. */
  takeTheirs(): void {
    const c = this.pendingConflict;
    if (!c) return;
    this.pendingConflict = null;
    this.version = c.version;
    this.savedText = this.text = c.text;
    this.hooks.reload(c.text);
    this.hooks.status('saved');
  }

  // ------------------------------------------------------------------

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.saveNow(), ms);
  }

  private async afterSave(): Promise<void> {
    const ext = this.externalVersion;
    this.externalVersion = null;
    if (ext) await this.external(ext);
    if (this.dirty && !this.pendingConflict && !this.inFlight) this.schedule(this.autosaveMs);
  }

  private async put(sent: string): Promise<void> {
    let res: Response;
    try {
      res = await this.fetch(this.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sent, base: this.version }),
      });
    } catch {
      this.hooks.status('error', 'Can’t reach the editor server. Is it still running?');
      this.schedule(this.retryMs);
      return;
    }
    if (res.status === 409) {
      this.raise((await res.json()) as StoryText);
      return;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      this.hooks.status('error', body.error ?? `Saving failed (${res.status}).`);
      this.schedule(this.retryMs);
      return;
    }
    const { version } = (await res.json()) as { version: string };
    this.version = version;
    this.savedText = sent;
    this.hooks.status(this.dirty ? 'unsaved' : 'saved');
  }

  private async get(): Promise<StoryText | null> {
    try {
      const res = await this.fetch(this.url);
      return res.ok ? ((await res.json()) as StoryText) : null;
    } catch {
      return null;
    }
  }

  private raise(theirs: StoryText): void {
    clearTimeout(this.timer);
    this.pendingConflict = theirs;
    this.hooks.status('conflict');
    this.hooks.conflict(theirs);
  }
}
