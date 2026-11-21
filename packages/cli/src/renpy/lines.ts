/**
 * Reading a Ren'Py script (.rpy) into logical lines and blocks, the way Ren'Py's own lexer does: a line continues
 * while a bracket or a string is open (Ren'Py strings may span lines) or after a backslash, `#` starts a comment
 * outside strings, and a line ending in `:` owns the more indented lines after it.
 */

export interface RpyLine {
  /** The logical line without its comment, trimmed. */
  text: string;
  /** First physical line, from 1. */
  line: number;
  indent: number;
  /** The more indented lines after a line ending in `:`. */
  block: RpyLine[];
}

/** Split a script into logical lines (text, line number, indentation), comments removed. */
export function logicalLines(source: string): { text: string; line: number; indent: number }[] {
  const src = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const out: { text: string; line: number; indent: number }[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    // Start of a physical line: its indentation.
    let indent = 0;
    while (i < src.length && (src[i] === ' ' || src[i] === '\t')) { indent += src[i] === '\t' ? 4 : 1; i++; }
    const startLine = line;
    let text = '';
    let depth = 0;
    let quote: string | null = null;
    let done = false;
    while (i < src.length && !done) {
      const c = src[i]!;
      if (quote) {
        if (c === '\\' && i + 1 < src.length) {
          text += c + src[i + 1];
          if (src[i + 1] === '\n') line++;
          i += 2;
          continue;
        }
        if (src.startsWith(quote, i)) { text += quote; i += quote.length; quote = null; continue; }
        if (c === '\n') line++;
        text += c;
        i++;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        quote = src.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
        text += quote;
        i += quote.length;
        continue;
      }
      if (c === '#') {
        // A comment: to the end of the physical line.
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }
      if (c === '\\' && src[i + 1] === '\n') { text += ' '; i += 2; line++; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
      if (c === '\n') {
        i++;
        line++;
        if (depth > 0) { text += ' '; continue; }
        done = true;
        continue;
      }
      text += c;
      i++;
    }
    const t = text.trim();
    if (t) out.push({ text: t, line: startLine, indent });
  }
  return out;
}

/** The script as a tree of blocks. */
export function parseRpy(source: string): RpyLine[] {
  const flat = logicalLines(source);
  let pos = 0;
  const readBlock = (minIndent: number): RpyLine[] => {
    const lines: RpyLine[] = [];
    const indent = pos < flat.length ? flat[pos]!.indent : 0;
    while (pos < flat.length && flat[pos]!.indent >= minIndent) {
      const l = flat[pos]!;
      // A line indented less than the block's first line ends the block (Ren'Py would call it an error).
      if (l.indent < indent) break;
      pos++;
      const node: RpyLine = { text: l.text, line: l.line, indent: l.indent, block: [] };
      if (pos < flat.length && flat[pos]!.indent > l.indent) node.block = readBlock(l.indent + 1);
      lines.push(node);
    }
    return lines;
  };
  const top: RpyLine[] = [];
  while (pos < flat.length) top.push(...readBlock(0));
  return top;
}

/** The lines of a block and everything in it, for copying as comments. */
export function flatten(lines: RpyLine[], base = lines[0]?.indent ?? 0): { text: string; line: number; depth: number }[] {
  const out: { text: string; line: number; depth: number }[] = [];
  const walk = (ls: RpyLine[]) => {
    for (const l of ls) {
      out.push({ text: l.text, line: l.line, depth: Math.max(0, l.indent - base) });
      walk(l.block);
    }
  };
  walk(lines);
  return out;
}
