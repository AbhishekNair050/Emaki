/**
 * VS Code extension entry: adapts `@emaki/language` to the editor.
 *
 * Bundled with esbuild into dist/extension.cjs (VS Code can't run .ts), with
 * the compiler from @emaki/format inlined, so it works without Node or npm on
 * the writer's machine.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import * as vscode from 'vscode';
import { MAIN_FILE, storyParts } from '@emaki/format/files';
import { Analysis, format, previewUrl, type CompletionKind, type StoryContext, type StorySymbol, type SymbolKind } from '@emaki/language';

const LANGUAGE = 'emaki';
const SELECTOR: vscode.DocumentSelector = { language: LANGUAGE };
const CHECK_DELAY_MS = 150;

/** Analyses keyed by document, reused until it or another file of its story changes. */
const cache = new WeakMap<vscode.TextDocument, { version: number; generation: number; analysis: Analysis }>();
/** Bumped whenever any script changes, since one file's names are used in the others. */
let generation = 0;

function analyze(doc: vscode.TextDocument): Analysis {
  const hit = cache.get(doc);
  if (hit && hit.version === doc.version && hit.generation === generation) return hit.analysis;
  const game = gameOf(doc.uri.fsPath);
  const analysis = new Analysis(doc.getText(), game ? storyContext(game, doc) : undefined);
  cache.set(doc, { version: doc.version, generation, analysis });
  return analysis;
}

/**
 * The game a script belongs to: the nearest folder above it with a story.vn,
 * when the script is that story.vn or one of the story's other files.
 */
function gameOf(file: string): { dir: string; path: string } | null {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(dir, MAIN_FILE))) {
      const path = relative(dir, file).split(sep).join('/');
      return path === MAIN_FILE || storyParts(dir).includes(path) ? { dir, path } : null;
    }
    if (dirname(dir) === dir) return null;
  }
}

/** Every file of the story, with the unsaved text of the ones open in the editor. */
function storyContext(game: { dir: string; path: string }, doc: vscode.TextDocument): StoryContext {
  const open = new Map(vscode.workspace.textDocuments.map((d) => [d.uri.fsPath.toLowerCase(), d]));
  const files = [MAIN_FILE, ...storyParts(game.dir)].map((path) => {
    const abs = join(game.dir, path);
    const text = abs.toLowerCase() === doc.uri.fsPath.toLowerCase() ? doc.getText() : open.get(abs.toLowerCase())?.getText() ?? readFileSync(abs, 'utf8');
    return { path, source: text };
  });
  return { file: game.path, files };
}

/** Where a definition is: this document, or another file of the story. */
async function locate(doc: vscode.TextDocument, a: Analysis, s: StorySymbol): Promise<vscode.Location> {
  if (s.file === a.file) return new vscode.Location(doc.uri, nameRange(doc, s));
  const game = gameOf(doc.uri.fsPath)!;
  const other = await vscode.workspace.openTextDocument(vscode.Uri.file(join(game.dir, s.file ?? MAIN_FILE)));
  return new vscode.Location(other.uri, nameRange(other, s));
}

export function activate(context: vscode.ExtensionContext): void {
  const problems = vscode.languages.createDiagnosticCollection(LANGUAGE);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const check = (doc: vscode.TextDocument) => {
    if (doc.languageId !== LANGUAGE) return;
    problems.set(doc.uri, analyze(doc).problems().map((p) => {
      const d = new vscode.Diagnostic(
        new vscode.Range(p.range.line, p.range.start, p.range.line, p.range.end),
        p.message,
        p.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
      );
      d.source = 'emaki';
      d.code = p.code;
      if (p.code === 'unreachable-label') d.tags = [vscode.DiagnosticTag.Unnecessary];
      return d;
    }));
  };
  const checkSoon = (doc: vscode.TextDocument) => {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); check(doc); }, CHECK_DELAY_MS));
  };

  /** A script changed: re-check every open script, since they share names. */
  const storyChanged = () => {
    generation++;
    for (const d of vscode.workspace.textDocuments) if (d.languageId === LANGUAGE) checkSoon(d);
  };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.vn');

  vscode.workspace.textDocuments.forEach(check);
  context.subscriptions.push(
    problems,
    watcher,
    watcher.onDidCreate(storyChanged),
    watcher.onDidDelete(storyChanged),
    watcher.onDidChange(storyChanged),
    vscode.workspace.onDidOpenTextDocument(check),
    vscode.workspace.onDidChangeTextDocument((e) => { if (e.document.languageId === LANGUAGE && e.contentChanges.length) storyChanged(); }),
    vscode.workspace.onDidCloseTextDocument((doc) => problems.delete(doc.uri)),

    vscode.languages.registerDocumentSymbolProvider(SELECTOR, {
      provideDocumentSymbols(doc) {
        return analyze(doc).ownSymbols().map((s) => {
          const range = new vscode.Range(s.line, 0, s.endLine, doc.lineAt(s.endLine).text.length);
          const name = doc.lineAt(s.line).range;
          return new vscode.DocumentSymbol(s.name, s.detail, SYMBOL_KINDS[s.kind], range, name);
        });
      },
    }),

    vscode.languages.registerDefinitionProvider(SELECTOR, {
      provideDefinition(doc, pos) {
        const a = analyze(doc);
        const s = a.definitionAt(pos.line, pos.character);
        return s && locate(doc, a, s);
      },
    }),

    vscode.languages.registerReferenceProvider(SELECTOR, {
      provideReferences(doc, pos, ctx) {
        const a = analyze(doc);
        const target = a.definitionAt(pos.line, pos.character);
        if (!target) return [];
        return a.referencesTo(target, ctx.includeDeclaration)
          .map((r) => new vscode.Location(doc.uri, new vscode.Range(r.line, r.start, r.line, r.end)));
      },
    }),

    vscode.languages.registerHoverProvider(SELECTOR, {
      provideHover(doc, pos) {
        const md = analyze(doc).hoverAt(pos.line, pos.character);
        return md ? new vscode.Hover(new vscode.MarkdownString(md)) : undefined;
      },
    }),

    vscode.languages.registerCompletionItemProvider(SELECTOR, {
      provideCompletionItems(doc, pos) {
        return analyze(doc).completionsAt(pos.line, pos.character).map((c) => {
          const item = new vscode.CompletionItem(c.label, COMPLETION_KINDS[c.kind]);
          item.detail = c.detail;
          return item;
        });
      },
    }, ' ', '{'),

    vscode.commands.registerTextEditorCommand('emaki.previewLine', (editor) => previewLine(editor)),

    vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, {
      provideDocumentFormattingEdits(doc) {
        const text = doc.getText();
        const out = format(text);
        if (out === null) {
          void vscode.window.setStatusBarMessage('Emaki: fix the errors in this script before formatting', 4000);
          return [];
        }
        if (out === text) return [];
        return [vscode.TextEdit.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), out)];
      },
    }),
  );
}

export function deactivate(): void {}

/** Open the running game (npm run dev) at the cursor's line. */
async function previewLine(editor: vscode.TextEditor): Promise<void> {
  const config = vscode.workspace.getConfiguration('emaki.preview');
  const base = config.get<string>('url', 'http://localhost:5173/');
  let url: string;
  try {
    url = previewUrl(base, editor.selection.active.line, gameOf(editor.document.uri.fsPath)?.path);
  } catch {
    void vscode.window.showErrorMessage(`Emaki: '${base}' isn't a valid address. Check the emaki.preview.url setting.`);
    return;
  }
  if (editor.document.isDirty) await editor.document.save(); // the dev server reads the file from disk
  if (config.get<string>('openIn', 'beside') === 'beside') {
    try {
      // Some versions open the browser in the active group whatever column is asked for,
      // so make the group to the right of the script active first (creating it if needed).
      const column = (editor.viewColumn ?? vscode.ViewColumn.One) + 1;
      const hasRight = vscode.window.tabGroups.all.some((g) => g.viewColumn === column);
      await vscode.commands.executeCommand(hasRight ? 'workbench.action.focusRightGroup' : 'workbench.action.newGroupRight');
      await vscode.commands.executeCommand('simpleBrowser.api.open', vscode.Uri.parse(url), { viewColumn: column, preserveFocus: false });
      await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, selection: editor.selection });
      return;
    } catch {
      // Built-in browser unavailable (e.g. disabled): fall back to the system browser.
    }
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

/** The range of a definition's name, for jumping to and highlighting. */
function nameRange(doc: vscode.TextDocument, s: StorySymbol): vscode.Range {
  const text = doc.lineAt(s.line).text;
  const at = text.indexOf(s.name);
  return at >= 0 ? new vscode.Range(s.line, at, s.line, at + s.name.length) : doc.lineAt(s.line).range;
}

const SYMBOL_KINDS: Record<SymbolKind, vscode.SymbolKind> = {
  label: vscode.SymbolKind.Function,
  character: vscode.SymbolKind.Class,
  image: vscode.SymbolKind.File,
  audio: vscode.SymbolKind.File,
  variable: vscode.SymbolKind.Variable,
  achievement: vscode.SymbolKind.Constant,
  ending: vscode.SymbolKind.Event,
};

const COMPLETION_KINDS: Record<CompletionKind, vscode.CompletionItemKind> = {
  label: vscode.CompletionItemKind.Function,
  character: vscode.CompletionItemKind.Class,
  image: vscode.CompletionItemKind.File,
  audio: vscode.CompletionItemKind.File,
  variable: vscode.CompletionItemKind.Variable,
  achievement: vscode.CompletionItemKind.Constant,
  ending: vscode.CompletionItemKind.Event,
  keyword: vscode.CompletionItemKind.Keyword,
  value: vscode.CompletionItemKind.EnumMember,
};
