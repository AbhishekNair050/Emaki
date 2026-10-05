/**
 * Printer: AST -> canonical `.vn` source.
 *
 * This is the foundation of the visual editor round-trip: the flowchart view
 * edits the AST, and the printer writes it back as clean, diff-friendly text.
 * Invariant (tested): parse(print(ast)) is structurally equal to ast.
 */
import type { AssetRef, Program, Stmt } from './ast.ts';
import { printExpr } from './expr.ts';

const INDENT = '  ';

export function print(program: Program): string {
  const out: string[] = [];

  if (program.meta.length) {
    out.push('---');
    for (const [k, v] of program.meta) out.push(`${k}: ${v}`);
    out.push('---', '');
  }

  const section = (lines: string[]) => {
    if (lines.length) out.push(...lines, '');
  };

  section(program.characters.map((c) => `define ${c.id} ${q(c.name)}${c.color ? ` color=${c.color}` : ''}`));
  section(program.images.map((i) => `image ${i.name} = ${q(i.path)}`));
  section(program.audio.map((a) => `audio ${a.name} = ${q(a.path)}`));
  section(program.vars.map((v) => `var ${v.name} = ${printExpr(v.init)}`));

  for (const l of program.labels) {
    out.push(`label ${l.name}:`);
    printBlock(l.body, 1, out);
    out.push('');
  }

  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

function printBlock(stmts: Stmt[], depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);
  for (const s of stmts) {
    switch (s.type) {
      case 'say': {
        if (s.who === null) out.push(pad + q(s.text));
        else {
          const who = [s.who, ...s.attrs].join(' ');
          // Quote dialogue only when it would otherwise be ambiguous.
          const needsQuotes = s.text.startsWith('"') || s.text !== s.text.trim() || s.text.includes('\n');
          out.push(`${pad}${who}: ${needsQuotes ? q(s.text) : s.text}`);
        }
        break;
      }
      case 'scene':
        out.push(pad + ['scene', s.image, withT(s.transition)].filter(Boolean).join(' '));
        break;
      case 'show':
        out.push(pad + ['show', s.tag, ...s.attrs, s.at ? `at ${s.at}` : '', withT(s.transition)].filter(Boolean).join(' '));
        break;
      case 'hide':
        out.push(pad + ['hide', s.tag, withT(s.transition)].filter(Boolean).join(' '));
        break;
      case 'play':
        out.push(pad + [
          'play', s.channel, asset(s.asset),
          s.loop === null ? '' : s.loop ? 'loop' : 'noloop',
          s.fade === null ? '' : `fade ${s.fade}`,
        ].filter(Boolean).join(' '));
        break;
      case 'stop':
        out.push(pad + ['stop', s.channel, s.fade === null ? '' : `fade ${s.fade}`].filter(Boolean).join(' '));
        break;
      case 'set':
        out.push(`${pad}set ${s.name} ${s.op} ${printExpr(s.expr)}`);
        break;
      case 'jump': case 'call':
        out.push(`${pad}${s.type} ${s.target}`);
        break;
      case 'return': case 'end':
        out.push(pad + s.type);
        break;
      case 'wait':
        out.push(`${pad}wait ${s.seconds}`);
        break;
      case 'menu':
        out.push(`${pad}menu:`);
        for (const c of s.choices) {
          out.push(`${pad}${INDENT}${q(c.text)}${c.cond ? ` if ${printExpr(c.cond)}` : ''}:`);
          printBlock(c.body, depth + 2, out);
        }
        break;
      case 'if':
        s.branches.forEach((b, i) => {
          if (b.cond === null) out.push(`${pad}else:`);
          else out.push(`${pad}${i === 0 ? 'if' : 'elif'} ${printExpr(b.cond)}:`);
          printBlock(b.body, depth + 1, out);
        });
        break;
    }
  }
}

function withT(t: string | null): string {
  return t ? `with ${t}` : '';
}

function asset(a: AssetRef): string {
  return a.kind === 'name' ? a.name : q(a.path);
}

function q(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}
