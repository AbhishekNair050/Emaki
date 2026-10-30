import { describe, expect, it } from 'vitest';
import { compile } from '@emaki/format';

const codes = (src: string) => compile(src).diagnostics.map((d) => d.code);

describe('title screen', () => {
  it('a label named title is the title screen: never the start, never unreachable', () => {
    const r = compile('label title:\n  menu:\n    "Play":\n      jump intro\n\nlabel intro:\n  "Hi."\n\nlabel extra:\n  "Only from the title."\n');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['unreachable-label']); // extra, not title
    expect(r.story!.start).toBe(r.story!.labels.intro);
  });

  it('checks the title header keys', () => {
    const head = (h: string) => codes(`---\n${h}\n---\nimage bg = "bg.png"\naudio theme = "theme.ogg"\nlabel start:\n  "Hi."\n`);
    expect(head('title_layout: left\ntitle_buttons: start, settings\ntitle_image: bg\ntitle_logo: logo.png\ntitle_music: theme')).toEqual([]);
    expect(head('title_layout: diagonal')).toEqual(['bad-title-layout']);
    expect(head('title_buttons: start, credits')).toEqual(['bad-title-buttons']);
    expect(head('title_image: nope')).toEqual(['unknown-image']);
    expect(head('title_music: nope')).toEqual(['unknown-audio']);
  });
});
