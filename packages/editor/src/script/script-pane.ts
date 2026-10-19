/**
 * The script pane: CodeMirror with Emaki's language features.
 *
 * Problems, completion, hover, go to definition and formatting all come from
 * `@emaki/language`, the same code behind the VS Code extension, so both
 * editors always agree with `emaki check`.
 */
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter, openLintPanel, type Diagnostic as LintDiagnostic } from '@codemirror/lint';
import { EditorState, Prec, StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, EditorView, hoverTooltip, keymap, type DecorationSet } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { tags as t } from '@lezer/highlight';
import { Analysis, format, type CompletionKind } from '@emaki/language';
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
}

/** One analysis per document version, shared by every feature. */
const analyses = new WeakMap<Text, Analysis>();
export function analysisOf(doc: Text): Analysis {
  let a = analyses.get(doc);
  if (!a) analyses.set(doc, (a = new Analysis(doc.toString())));
  return a;
}

export class ScriptPane {
  readonly view: EditorView;
  private readonly hooks: ScriptPaneHooks;
  private applyingExternal = false;

  constructor(parent: HTMLElement, text: string, hooks: ScriptPaneHooks) {
    this.hooks = hooks;
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [
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
            { key: 'Mod-s', run: () => { this.hooks.onSave?.(); return true; }, preventDefault: true },
            { key: 'F12', run: (v) => goToDefinition(v, v.state.selection.main.head) },
            { key: 'Shift-Alt-f', run: (v) => formatDocument(v) },
            { key: 'Mod-Shift-m', run: openLintPanel },
            indentWithTab,
          ])),
          EditorView.domEventHandlers({
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
        ],
      }),
    });
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
  label: 'function', character: 'class', image: 'type', audio: 'type', variable: 'variable', keyword: 'keyword', value: 'constant',
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
  const sym = analysisOf(view.state.doc).definitionAt(line.number - 1, pos - line.from);
  if (!sym) return false;
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
