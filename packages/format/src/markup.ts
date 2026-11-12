/**
 * Text styling inside dialogue, narration and choices.
 *
 *   *italic*   **bold**   ***both***   [color=#e8b04b]coloured[/color]
 *   [w] wait for a click   [w=1.5] pause 1.5 s   [nw] (at the end) go on without a click
 *   [ruby=うすくれない]薄紅[/ruby]   a reading (furigana) shown above the text
 *   \*  \[  \]  \\  \#   literal characters (\# where a # would start a comment)
 *
 * Parsed at compile time into styled spans so runtimes never re-parse
 * markup, and so a variable's value (`{name}`) can never be mistaken for
 * markup. Square brackets that aren't a colour tag are ordinary text.
 */

export interface Span {
  text: string;
  b?: true;
  i?: true;
  color?: string;
  /** A reading shown above this span's text (furigana): `[ruby=reading]text[/ruby]`. */
  ruby?: string;
  /**
   * A pause in the text (the span's text is empty): `'click'` waits for the
   * player (`[w]`), a number waits that many seconds (`[w=1.5]`), and `'next'`
   * (`[nw]`, only last) moves on to the next line without a click.
   */
  pause?: 'click' | 'next' | number;
}

/** Longest `[w=...]` pause, in seconds. */
export const MAX_PAUSE = 30;

export interface MarkupResult {
  spans: Span[];
  /** The text with markup removed (for logs, screen readers, plain runtimes). */
  plain: string;
  /** True if any styling or pause is present (spans are only worth storing then). */
  styled: boolean;
  /** Friendly error message, or null. */
  error: string | null;
}

const COLOR_OPEN = /^\[color=([^\]\s]*)\]/;
const COLOR_CLOSE = '[/color]';
const RUBY_OPEN = /^\[ruby=([^\]]*)\]/;
const RUBY_CLOSE = '[/ruby]';
const PAUSE = /^\[(w|nw)(?:=([^\]]*))?\]/;
const COLOR_VALUE = /^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|[a-zA-Z]{3,20})$/;
const ESCAPABLE = '*[]\\#';

export function parseMarkup(src: string): MarkupResult {
  const spans: Span[] = [];
  let bold = false;
  let italic = false;
  const colors: string[] = [];
  let ruby: string | null = null;
  let buf = '';
  let error: string | null = null;

  const flush = () => {
    if (!buf) return;
    const span: Span = { text: buf };
    if (bold) span.b = true;
    if (italic) span.i = true;
    if (colors.length) span.color = colors[colors.length - 1];
    if (ruby !== null) span.ruby = ruby;
    const prev = spans[spans.length - 1];
    // A reading belongs to its own text, so ruby spans never merge with their neighbours.
    if (prev && prev.pause === undefined && ruby === null && prev.ruby === undefined && prev.b === span.b && prev.i === span.i && prev.color === span.color) prev.text += buf;
    else spans.push(span);
    buf = '';
  };

  for (let k = 0; k < src.length;) {
    const c = src[k];
    if (c === '\\' && k + 1 < src.length && ESCAPABLE.includes(src[k + 1])) {
      buf += src[k + 1];
      k += 2;
      continue;
    }
    if (src.startsWith('**', k)) {
      flush();
      bold = !bold;
      k += 2;
      continue;
    }
    if (c === '*') {
      flush();
      italic = !italic;
      k += 1;
      continue;
    }
    if (c === '[') {
      const open = COLOR_OPEN.exec(src.slice(k));
      if (open) {
        if (!COLOR_VALUE.test(open[1])) {
          error ??= `'${open[1]}' isn't a colour. Use a hex code like #e8b04b or a name like gold`;
        }
        flush();
        colors.push(open[1]);
        k += open[0].length;
        continue;
      }
      const rb = RUBY_OPEN.exec(src.slice(k));
      if (rb) {
        if (ruby !== null) error ??= `'[ruby=...]' can't go inside another one; close the first with [/ruby]`;
        if (!rb[1]!.trim()) error ??= `'[ruby=]' needs the reading, like [ruby=さくら]桜[/ruby]`;
        flush();
        ruby = rb[1]!;
        k += rb[0].length;
        continue;
      }
      if (src.startsWith(RUBY_CLOSE, k)) {
        if (ruby === null) error ??= `'[/ruby]' has no matching '[ruby=...]' before it`;
        else if (!buf) error ??= `'[ruby=${ruby}]' has no text to go over`;
        flush();
        ruby = null;
        k += RUBY_CLOSE.length;
        continue;
      }
      const pause = PAUSE.exec(src.slice(k));
      if (pause) {
        flush();
        k += pause[0].length;
        if (pause[1] === 'nw') {
          if (pause[2] !== undefined) error ??= `'[nw]' takes no value`;
          if (src.slice(k).trim()) error ??= `'[nw]' goes at the very end of the line`;
          spans.push({ text: '', pause: 'next' });
        } else if (pause[2] === undefined) spans.push({ text: '', pause: 'click' });
        else {
          const n = Number(pause[2]);
          if (!/^\d+(\.\d+)?$/.test(pause[2]) || n > MAX_PAUSE) error ??= `'[w=${pause[2]}]' needs seconds from 0 to ${MAX_PAUSE}, like [w=1.5]`;
          else spans.push({ text: '', pause: n });
        }
        continue;
      }
      if (src.startsWith(COLOR_CLOSE, k)) {
        if (!colors.length) error ??= `'[/color]' has no matching '[color=...]' before it`;
        flush();
        colors.pop();
        k += COLOR_CLOSE.length;
        continue;
      }
    }
    buf += c;
    k++;
  }
  flush();

  if (bold) error ??= `Unclosed '**' (bold). To show asterisks, write \\*`;
  if (italic) error ??= `Unclosed '*' (italic). To show an asterisk, write \\*`;
  if (ruby !== null) error ??= `Unclosed '[ruby=${ruby}]'. Add [/ruby] after the text it reads`;
  if (colors.length) error ??= `Unclosed '[color=${colors[colors.length - 1]}]'. Add [/color] where the colour should end`;

  const plain = spans.map((s) => s.text).join('');
  const styled = spans.some((s) => s.b || s.i || s.color || s.ruby !== undefined || s.pause !== undefined);
  return { spans, plain, styled, error };
}
