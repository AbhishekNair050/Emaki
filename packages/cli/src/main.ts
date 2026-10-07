#!/usr/bin/env node
/**
 * Emaki CLI.
 *
 *   emaki check <story.vn>            report errors and warnings
 *   emaki build <story.vn> [out.json] compile to the runtime format
 *   emaki graph <story.vn>            print a Mermaid flowchart of labels
 *   emaki fmt <story.vn> [--write]    print (or rewrite) in canonical form
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { buildGraph, compile, parse, print, toMermaid, type Diagnostic } from '@emaki/format';

const [cmd, file, ...rest] = process.argv.slice(2);

const USAGE = `Usage:
  emaki check <story.vn>
  emaki build <story.vn> [out.json]
  emaki graph <story.vn>
  emaki fmt   <story.vn> [--write]`;

if (!cmd || !file || cmd === 'help' || cmd === '--help') {
  console.log(USAGE);
  process.exit(cmd ? 0 : 1);
}

let source: string;
try {
  source = readFileSync(file, 'utf8');
} catch {
  console.error(`Can't read '${file}'`);
  process.exit(1);
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

function report(diags: Diagnostic[]): boolean {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  for (const d of diags) {
    const tag = d.severity === 'error' ? c('31;1', 'error') : c('33;1', 'warning');
    console.log(`${basename(file)}:${d.line}: ${tag} ${d.message} ${c('2', `[${d.code}]`)}`);
    const src = lines[d.line - 1];
    if (src !== undefined) console.log(c('2', `  ${String(d.line).padStart(4)} | `) + src.trim());
  }
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warnings = diags.length - errors;
  console.log(errors || warnings
    ? `${errors} error(s), ${warnings} warning(s)`
    : c('32', '✓ No problems found'));
  return errors === 0;
}

switch (cmd) {
  case 'check': {
    const r = compile(source);
    const ok = report(r.diagnostics);
    if (r.story) {
      const says = r.story.code.filter((i) => i.op === 'say').length;
      const menus = r.story.code.filter((i) => i.op === 'menu').length;
      console.log(c('2', `${Object.keys(r.story.labels).length} labels, ${says} lines of dialogue, ${menus} menus`));
    }
    process.exit(ok ? 0 : 1);
  }
  // falls through (unreachable; process.exit above)
  case 'build': {
    const r = compile(source);
    if (!report(r.diagnostics) || !r.story) process.exit(1);
    const out = rest[0] ?? file.replace(/\.vn$/, '') + '.compiled.json';
    writeFileSync(out, JSON.stringify(r.story, null, 2));
    console.log(`Wrote ${out}`);
    break;
  }
  case 'graph': {
    const { program, diagnostics } = parse(source);
    if (diagnostics.some((d) => d.severity === 'error')) { report(diagnostics); process.exit(1); }
    process.stdout.write(toMermaid(buildGraph(program)));
    break;
  }
  case 'fmt': {
    const { program, diagnostics } = parse(source);
    if (diagnostics.some((d) => d.severity === 'error')) {
      report(diagnostics);
      console.error('Not formatting a file with errors.');
      process.exit(1);
    }
    const out = print(program);
    if (rest.includes('--write')) {
      writeFileSync(file, out);
      console.log(`Formatted ${file} (note: comments are not preserved yet)`);
    } else process.stdout.write(out);
    break;
  }
  default:
    console.error(`Unknown command '${cmd}'\n\n${USAGE}`);
    process.exit(1);
}
