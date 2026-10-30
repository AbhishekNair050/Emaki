import { describe, expect, it } from 'vitest';
import { compile, parse, print, updateCatalog } from '@emaki/format';
import { Runner } from '@emaki/runtime';

const SRC = `image beach = "cg/beach.png" gallery
image room = "bg/room.png"
image night = "cg/night.png" gallery

ending sunrise "Sunrise"
ending alone "Alone"

label start:
  scene beach
  "The end of the road."
  end sunrise
`;

describe('gallery images and endings', () => {
  it('parse, print back and compile', () => {
    const p = parse(SRC);
    expect(p.diagnostics).toEqual([]);
    const printed = print(p.program);
    expect(printed).toContain('image beach = "cg/beach.png" gallery\n');
    expect(printed).toContain('ending sunrise "Sunrise"\n');
    expect(printed).toContain('  end sunrise\n');
    const r = compile(SRC);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.story!.gallery).toEqual(['beach', 'night']);
    expect(r.story!.endings).toEqual({ sunrise: { name: 'Sunrise' }, alone: { name: 'Alone' } });
    expect(compile('label start:\n  "x"\n').story!).not.toHaveProperty('gallery');
  });

  it('catches mistakes', () => {
    const codes = (src: string) => compile(src).diagnostics.map((d) => d.code);
    expect(codes('ending a "A"\nlabel start:\n  "x"\n  end b\n')).toEqual(['unknown-ending']);
    expect(codes('ending a "A"\nending a "B"\nlabel start:\n  "x"\n')).toEqual(['duplicate']);
    expect(codes('image a = "a.png" galery\nlabel start:\n  "x"\n')).toEqual(['bad-image']);
  });

  it('reports the ending reached, translated, and offers names for translation', () => {
    const r = compile(SRC);
    const run = new Runner(r.story!);
    run.start();
    const step = run.advance();
    expect(step.block.type).toBe('end');
    expect(step.effects).toEqual([{ type: 'ending', id: 'sunrise', name: 'Sunrise' }]);
    const cat = updateCatalog(r.strings, null, 'fr');
    expect(cat.entries.find((e) => e.id === 'ending.sunrise')).toMatchObject({ kind: 'ending', source: 'Sunrise' });
  });
});
