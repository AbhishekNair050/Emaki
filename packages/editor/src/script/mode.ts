/**
 * Syntax highlighting for `.vn` scripts in CodeMirror.
 *
 * A line-based tokenizer is plenty: the language is line-oriented and every
 * construct is recognisable from the start of its line. Mirrors the TextMate
 * grammar used by the VS Code extension, so both editors colour alike.
 */
import { StreamLanguage, type StreamParser, type StringStream } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

interface State {
  /** Front matter: 'maybe' until the first line, 'in' inside `---` … `---`, then 'done'. */
  header: 'maybe' | 'in' | 'done';
  /** What the next word on this line means. */
  next: 'labelDef' | 'charDef' | 'assetDef' | 'varDef' | 'label' | 'channel' | 'audio' | 'image' | null;
  /** Inside dialogue text (after `speaker:` or between narration quotes). */
  dialogue: 'colon' | 'quote' | null;
}

const TOP_LEVEL = /^(define|image|audio|var|label)\b/;
const STATEMENT = /^(scene|show|hide|play|stop|set|jump|call|return|end|wait|menu|if|elif|else)\b/;
const WORD_KEYWORD = /^(with|at|fade|loop|and|or|not|if)\b/;
const ATOM = /^(true|false)\b/;

const parser: StreamParser<State> = {
  name: 'emaki',
  startState: () => ({ header: 'maybe', next: null, dialogue: null }),
  copyState: (s) => ({ ...s }),

  token(stream, state) {
    if (stream.sol()) {
      state.next = null;
      state.dialogue = null;
      if (state.header === 'maybe') {
        state.header = stream.match(/^---\s*$/) ? 'in' : 'done';
        if (state.header === 'in') return 'meta';
      } else if (state.header === 'in') {
        if (stream.match(/^---\s*$/)) { state.header = 'done'; return 'meta'; }
        if (stream.match(/^\s*#.*/)) return 'comment';
        if (stream.match(/^\s*[\w-]+(?=\s*:)/)) return 'propertyName';
        stream.skipToEnd();
        return 'string';
      }
      if (stream.match(/^\s*#.*/)) return 'comment';
      const top = stream.match(TOP_LEVEL) as RegExpMatchArray | null;
      if (top) {
        const k = top[1];
        state.next = k === 'label' ? 'labelDef' : k === 'define' ? 'charDef' : k === 'var' ? 'varDef' : 'assetDef';
        return 'keyword';
      }
    }
    if (state.header === 'in') {
      if (stream.match(/^\s*:\s*/)) return 'punctuation';
      stream.skipToEnd();
      return 'string';
    }
    if (state.dialogue) return dialogue(stream, state);
    if (stream.eatSpace()) return null;

    // First word of an indented line: a statement, narration, or `speaker attrs:`.
    if (isLineStart(stream)) {
      const stmt = stream.match(STATEMENT) as RegExpMatchArray | null;
      if (stmt) {
        const k = stmt[1];
        state.next = k === 'jump' || k === 'call' ? 'label' : k === 'play' || k === 'stop' ? 'channel'
          : k === 'scene' || k === 'show' || k === 'hide' ? 'image' : null;
        return 'keyword';
      }
      if (stream.peek() === '"') {
        // Narration ("...") or a menu choice ("...":) — both are prose.
        stream.next();
        state.dialogue = 'quote';
        return 'dialogue';
      }
      if (stream.match(/^[A-Za-z_]\w*(?=(\s+[A-Za-z_]\w*)*\s*:)/)) {
        state.next = null;
        return 'speaker';
      }
    }

    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^#[0-9a-fA-F]{3,8}\b/)) return 'color';
    if (stream.match(/^-?\d+(\.\d+)?/)) return 'number';
    if (stream.match(ATOM)) return 'atom';
    if (stream.match(WORD_KEYWORD)) return 'keyword';
    const word = stream.match(/^[A-Za-z_]\w*/) as RegExpMatchArray | null;
    if (word) {
      const next = state.next;
      if (next === 'channel') { state.next = 'audio'; return 'atom'; }
      if (next !== 'image' && next !== 'assetDef') state.next = null;
      switch (next) {
        case 'labelDef': return 'labelDef';
        case 'label': return 'label';
        case 'charDef': return 'speaker';
        case 'varDef': return 'variableDef';
        case 'assetDef': case 'image': case 'audio': return 'asset';
        default: return 'variableName';
      }
    }
    if (stream.eat(':')) {
      // `speaker attrs: text` → the rest of the line is dialogue.
      if (/^\s*\S/.test(stream.string.slice(stream.pos)) && isSayLine(stream.string)) state.dialogue = 'colon';
      return 'punctuation';
    }
    if (stream.eat('=')) { if (state.next === 'assetDef') state.next = null; return 'operator'; }
    if (stream.match(/^[-+*/<>!=]=?/)) return 'operator';
    stream.next();
    return null;
  },

  blankLine(state) {
    if (state.header === 'maybe') state.header = 'done';
  },

  languageData: { commentTokens: { line: '#' } },

  tokenTable: {
    meta: t.meta,
    propertyName: t.propertyName,
    labelDef: t.definition(t.labelName),
    label: t.labelName,
    speaker: t.className,
    variableDef: t.definition(t.variableName),
    asset: t.typeName,
    dialogue: t.content,
    interpolation: t.special(t.variableName),
    markup: t.processingInstruction,
    color: t.color,
  },
};

/** Prose: plain text, with `{variables}` and `*`/`**`/`[color=...]` markup picked out. */
function dialogue(stream: StringStream, state: State): string {
  if (stream.match(/^\{[^}]*\}?/)) return 'interpolation';
  if (stream.match(/^(\*\*|\*|\[\/?color[^\]]*\])/)) return 'markup';
  if (stream.match(/^\\./)) return 'dialogue';
  if (state.dialogue === 'quote' && stream.eat('"')) {
    state.dialogue = null;
    return 'dialogue';
  }
  const stop = state.dialogue === 'quote' ? /[{*[\\"]/ : /[{*[\\]/;
  while (!stream.eol() && !stop.test(stream.peek()!)) stream.next();
  if (stream.pos === stream.start) stream.next();
  return 'dialogue';
}

function isLineStart(stream: StringStream): boolean {
  return stream.string.slice(0, stream.pos).trim() === '';
}

function isSayLine(line: string): boolean {
  return /^\s+[A-Za-z_]\w*(\s+[A-Za-z_]\w*)*\s*:/.test(line) && !/^\s+(menu|else)\s*:/.test(line);
}

export const emakiLanguage = StreamLanguage.define(parser);
