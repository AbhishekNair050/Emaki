import { describe, expect, it } from 'vitest';
import { compileFiles } from '@emaki/format';
import { Runner } from '@emaki/runtime';
import { parsePreview } from '../src/preview.ts';

const MAIN = `---
title: Two Files
---
define ann "Ann"
var met = false

label start:
  ann: Hello.
  jump chapter_two
`;
const PART = `image room = "bg/room.png"

label chapter_two:
  scene room
  set met = true
  ann: We meet again.
  jump the_end

label the_end:
  "Fin."
`;


describe('multi-file previews', () => {
  it('starts at a line of a given file', () => {
    const r = compileFiles(MAIN, [{ path: 'chapters/two.vn', source: PART }]);
    const run = new Runner(r.story!);
    expect(run.startAtLine(6, { file: 'chapters/two.vn' }).block).toMatchObject({ text: 'We meet again.', file: 'chapters/two.vn', line: 6 });
    expect(run.scene().bg).toBe('room');
    expect(run.startAtLine(8).block).toMatchObject({ text: 'Hello.', line: 8 });
    expect(run.startAtLine(8).block).not.toHaveProperty('file');
  });
  it('reads file= from preview links', () => {
    expect(parsePreview('?file=chapters/two.vn&line=6', {})).toEqual({ line: 6, file: 'chapters/two.vn', vars: {}, ignored: [] });
    expect(parsePreview('?file=story.vn&line=6', {})).toEqual({ line: 6, vars: {}, ignored: [] });
  });
});
