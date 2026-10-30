/**
 * The script pane: CodeMirror with Emaki's language features.
 *
 * Problems, completion, hover, go to definition and formatting all come from
 * `@emaki/language`, the same code behind the VS Code extension, so both
 * editors always agree with `emaki check`.
 */
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { indentWithTab, redo, undo } from '@codemirror/commands';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { forceLinting, linter, lintGutter, openLintPanel, type Diagnostic as LintDiagnostic } from '@codemirror/lint';
import { EditorState, Prec, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, hoverTooltip, keymap, type DecorationSet } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { tags as t } from '@lezer/highlight';
import { Analysis, format, type CompletionKind, type StoryContext, type StorySymbol } from '@emaki/language';
import { emakiLanguage } from './mode.ts';

export interface ScriptPaneHooks {
  /** The text changed (typing, undo, formatting...). */
  onChange(text: string): void;
  /** Ctrl+Enter: play from this 1-based line. */
  onRun(line: number): void;
  /** The cursor moved to another line (1-based). */
  onCursor?(line: number): void;
  /** Ctrl+S. */
  onSave?(): void;
  /**
   * Something was dropped on the script: an asset from the asset browser, or
   * files from the computer. `line` is the 1-based line it was dropped on.
   */
  onDrop?(drop: { asset?: DraggedAsset; files?: File[] }, line: number): void;
  /** The rest of the story (multi-file stories): the other files' current text. */
  context?(): StoryContext | undefined;
  /** Go to a definition in another file (F12, Ctrl+click). */
  openDefinition?(sym: StorySymbol): void;
}

/** What the asset browser puts on the drag (see ASSET_MIME). */
export interface DraggedAsset {
  path: string;
  kind: 'image' | 'audio';
}
export const ASSET_MIME = 'application/x-emaki-asset';

/**
 * One analysis per document version (and version of the other files), shared
 * by every feature. The pane says which file is open and where the rest of the
 * story is, so names from other files are known.
 */
const analyses = new WeakMap<Text, { generation: number; analysis: Analysis }>();
let storyContext: (() => StoryContext | undefined) | null = null;
let generation = 0;
let openDefinitionElsewhere: ((sym: StorySymbol) => void) | null = null;
export function analysisOf(doc: Text): Analysis {
  const hit = analyses.get(doc);
  if (hit && hit.generation === generation) return hit.analysis;
  const analysis = new Analysis(doc.toString(), storyContext?.() ?? undefined);
  analyses.set(doc, { generation, analysis });
  return analysis;
}

export class ScriptPane {
  readonly view: EditorView;
  private readonly hooks: ScriptPaneHooks;
  private applyingExternal = false;
  private readonly extensions: Extension[];
  /** Each open file's editor state (text, cursor, undo history), by path. */
  private readonly states = new Map<string, EditorState>();
  /** The file shown, as a path in the game folder. */
  file: string;

  constructor(parent: HTMLElement, text: string, hooks: ScriptPaneHooks, file = 'story.vn') {
    this.hooks = hooks;
    this.file = file;
    if (hooks.context) storyContext = () => hooks.context!();
    if (hooks.openDefinition) openDefinitionElsewhere = (sym) => hooks.openDefinition!(sym);
    this.extensions = [
      basicSetup,
      emakiLanguage,
      syntaxHighlighting(highlight),
      indentUnit.of('  '),
      EditorState.tabSize.of(2),
      theme,
      // Dialogue lines are long; a writer needs to see all of each one.
      EditorView.lineWrapping,
      playLineField,
      lintGutter(),
      linter((view) => problems(view), { delay: 250 }),
      autocompletion({ override: [complete], icons: false }),
      hoverTooltip(hover),
      // Highest precedence: the default keymap also binds Mod-Enter (insert blank line).
      Prec.highest(keymap.of([
        { key: 'Mod-Enter', run: (v) => { this.hooks.onRun(lineAt(v)); return true; } },
        // CodeMirror only binds Ctrl+Y on Windows/Linux; writers coming from VS Code expect this too.
        { key: 'Mod-Shift-z', run: redo, preventDefault: true },
        { key: 'Mod-s', run: () => { this.hooks.onSave?.(); return true; }, preventDefault: true },
        { key: 'F12', run: (v) => goToDefinition(v, v.state.selection.main.head) },
        { key: 'Shift-Alt-f', run: (v) => formatDocument(v) },
        { key: 'Mod-Shift-m', run: openLintPanel },
        indentWithTab,
      ])),
      EditorView.domEventHandlers({
        dragover: (e) => {
          if (!this.hooks.onDrop || !accepts(e.dataTransfer)) return false;
          e.preventDefault();
          e.dataTransfer!.dropEffect = 'copy';
          return false; // let CodeMirror draw its drop cursor
        },
        drop: (e, v) => {
          if (!this.hooks.onDrop || !accepts(e.dataTransfer)) return false;
          e.preventDefault();
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.doc.length;
          const raw = e.dataTransfer!.getData(ASSET_MIME);
          const files = [...(e.dataTransfer!.files ?? [])];
          // Dropping between lines inserts before the line under the pointer.
          const line = v.state.doc.lineAt(pos).number;
          if (raw) this.hooks.onDrop({ asset: JSON.parse(raw) as DraggedAsset }, line);
          else if (files.length) this.hooks.onDrop({ files }, line);
          return true;
        },
        mousedown: (e, v) => {
          if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false;
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
          return pos !== null && goToDefinition(v, pos) && (e.preventDefault(), true);
        },
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !this.applyingExternal) this.hooks.onChange(u.state.doc.toString());
        if (u.selectionSet || u.docChanged) this.hooks.onCursor?.(lineAt(u.view));
      }),
    ];
    this.view = new EditorView({ parent, state: EditorState.create({ doc: text, extensions: this.extensions }) });
  }

  /**
   * Show another file of the story. Each file keeps its own cursor and undo
   * history while the writer switches between them.
   */
  open(file: string, text: string): void {
    if (file === this.file) { this.setText(text); return; }
    this.states.set(this.file, this.view.state);
    this.file = file;
    const saved = this.states.get(file);
    this.view.setState(saved ?? EditorState.create({ doc: text, extensions: this.extensions }));
    if (saved) this.setText(text);
    this.contextChanged();
  }

  /** Forget a file's editor state (it was deleted). */
  forget(file: string): void {
    this.states.delete(file);
  }

  /** The other files changed: re-check this one against them. */
  contextChanged(): void {
    generation++;
    forceLinting(this.view);
  }

  get text(): string {
    return this.view.state.doc.toString();
  }

  get analysis(): Analysis {
    return analysisOf(this.view.state.doc);
  }

  /** 1-based line the cursor is on. */
  get cursorLine(): number {
    return lineAt(this.view);
  }

  /** Replace the text (it changed on disk), keeping the cursor on the same line number. */
  setText(text: string): void {
    if (text === this.text) return;
    const line = this.cursorLine;
    this.applyingExternal = true;
    try {
      this.view.dispatch({ changes: minimalChange(this.view.state.doc, text) });
    } finally {
      this.applyingExternal = false;
    }
    this.revealLine(Math.min(line, this.view.state.doc.lines), false);
  }

  /**
   * Replace the text as an edit the writer made (from the flowchart or the
   * asset browser): it can be undone with Ctrl+Z, and it is saved and played
   * like typing. Then show `line`.
   */
  applyEdit(text: string, line: number): void {
    if (text !== this.text) this.view.dispatch({ changes: minimalChange(this.view.state.doc, text), userEvent: 'input.emaki' });
    this.revealLine(line);
  }

  /** Scroll a 1-based line into view, optionally putting the cursor at its start. */
  revealLine(line: number, select = true, focus = select): void {
    const doc = this.view.state.doc;
    const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
    const indent = /^\s*/.exec(l.text)![0].length;
    this.view.dispatch({
      selection: select ? { anchor: l.from + indent } : undefined,
      effects: EditorView.scrollIntoView(l.from, { y: 'center' }),
    });
    if (focus) this.view.focus();
  }

  /** Mark the line the game is showing (1-based), or none. */
  setPlayLine(line: number | null): void {
    this.view.dispatch({ effects: setPlayLine.of(line) });
  }

  undo(): boolean {
    return undo(this.view);
  }

  redo(): boolean {
    return redo(this.view);
  }

  showProblems(): void {
    openLintPanel(this.view);
  }

  format(): boolean {
    return formatDocument(this.view);
  }
}

// ------------------------------------------------------------------ features

function problems(view: EditorView): LintDiagnostic[] {
  const doc = view.state.doc;
  return analysisOf(doc).problems().map((p) => {
    const line = doc.line(Math.min(p.range.line + 1, doc.lines));
    return {
      from: Math.min(line.from + p.range.start, line.to),
      to: Math.min(line.from + p.range.end, line.to),
      severity: p.severity,
      message: p.message,
      source: p.code,
    };
  });
}

const COMPLETION_TYPE: Record<CompletionKind, string> = {
  label: 'function', character: 'class', image: 'type', audio: 'type', variable: 'variable', achievement: 'constant', ending: 'constant', keyword: 'keyword', value: 'constant',
};

function complete(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/[A-Za-z_]\w*/);
  const line = ctx.state.doc.lineAt(ctx.pos);
  const items = analysisOf(ctx.state.doc).completionsAt(line.number - 1, ctx.pos - line.from);
  if (!items.length || (!word && !ctx.explicit && !/\s$|\{$/.test(line.text.slice(0, ctx.pos - line.from)))) return null;
  return {
    from: word ? word.from : ctx.pos,
    options: items.map((c) => ({ label: c.label, type: COMPLETION_TYPE[c.kind], detail: c.detail })),
    validFor: /^\w*$/,
  };
}

function hover(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  const md = analysisOf(view.state.doc).hoverAt(line.number - 1, pos - line.from);
  if (!md) return null;
  return {
    pos,
    above: true,
    create: () => {
      const dom = document.createElement('div');
      dom.className = 'cm-emaki-hover';
      dom.innerHTML = inlineMarkdown(md);
      return { dom };
    },
  };
}

function goToDefinition(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos);
  const analysis = analysisOf(view.state.doc);
  const sym = analysis.definitionAt(line.number - 1, pos - line.from);
  if (!sym) return false;
  if (sym.file !== analysis.file) {
    openDefinitionElsewhere?.(sym);
    return !!openDefinitionElsewhere;
  }
  const target = view.state.doc.line(sym.line + 1);
  const at = target.from + Math.max(0, target.text.indexOf(sym.name));
  view.dispatch({
    selection: { anchor: at, head: at + sym.name.length },
    effects: EditorView.scrollIntoView(at, { y: 'center' }),
  });
  return true;
}

function formatDocument(view: EditorView): boolean {
  const out = format(view.state.doc.toString());
  if (out === null || out === view.state.doc.toString()) return out !== null;
  view.dispatch({ changes: minimalChange(view.state.doc, out) });
  return true;
}

/** Replace only the part that differs, so the cursor and undo history stay sensible. */
function minimalChange(doc: Text, next: string): { from: number; to: number; insert: string } {
  const prev = doc.toString();
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) { endPrev--; endNext--; }
  return { from: start, to: endPrev, insert: next.slice(start, endNext) };
}

function accepts(dt: DataTransfer | null): boolean {
  return !!dt && (dt.types.includes(ASSET_MIME) || dt.types.includes('Files'));
}

function lineAt(view: EditorView): number {
  return view.state.doc.lineAt(view.state.selection.main.head).number;
}

function inlineMarkdown(md: string): string {
  const esc = md.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

// ------------------------------------------------------------------ "the game is here" line

const setPlayLine = StateEffect.define<number | null>();
const playLineDeco = Decoration.line({ class: 'cm-play-line', attributes: { title: 'The game is showing this line' } });

const playLineField = StateField.define<{ line: number | null; deco: DecorationSet }>({
  create: () => ({ line: null, deco: Decoration.none }),
  update(value, tr) {
    let line = value.line;
    for (const e of tr.effects) if (e.is(setPlayLine)) line = e.value;
    if (line === value.line && !tr.docChanged) return value;
    if (line === null || line > tr.state.doc.lines) return { line, deco: Decoration.none };
    return { line, deco: Decoration.set([playLineDeco.range(tr.state.doc.line(line).from)]) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

// ------------------------------------------------------------------ look

const highlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.meta, color: 'var(--syn-comment)' },
  { tag: t.keyword, color: 'var(--syn-keyword)' },
  { tag: [t.labelName, t.definition(t.labelName)], color: 'var(--syn-label)' },
  { tag: t.definition(t.labelName), fontWeight: '600' },
  { tag: t.className, color: 'var(--syn-speaker)', fontWeight: '600' },
  { tag: t.typeName, color: 'var(--syn-asset)' },
  { tag: [t.variableName, t.definition(t.variableName), t.propertyName], color: 'var(--syn-variable)' },
  { tag: t.special(t.variableName), color: 'var(--syn-variable)', fontWeight: '600' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: t.content, color: 'var(--syn-prose)' },
  { tag: t.processingInstruction, color: 'var(--syn-keyword)' },
  { tag: [t.number, t.atom, t.color], color: 'var(--syn-number)' },
  { tag: t.operator, color: 'var(--syn-operator)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', backgroundColor: 'var(--pane-bg)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--code-font)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'var(--pane-bg)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
  '.cm-play-line': { boxShadow: 'inset 3px 0 0 var(--accent)', backgroundColor: 'var(--play-line)' },
  '.cm-tooltip': { backgroundColor: 'var(--panel-bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px' },
  '.cm-emaki-hover': { padding: '6px 10px', maxWidth: '420px', fontFamily: 'var(--ui-font)', fontSize: '13px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--selection)', color: 'var(--text)' },
  '.cm-panels': { backgroundColor: 'var(--panel-bg)', color: 'var(--text)' },
  '.cm-searchMatch': { backgroundColor: 'var(--search-match)' },
  '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)' },
});
