import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, INSTANT_SPEED, sanitizeSettings } from '../src/settings.ts';

describe('player settings', () => {
  it('fills in defaults for anything missing', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ textScale: 1.2 })).toEqual({ ...DEFAULT_SETTINGS, textScale: 1.2 });
  });

  it('clamps numbers into their allowed range', () => {
    const s = sanitizeSettings({ textSpeed: 9999, musicVolume: -1, boxOpacity: 0.1, autoDelay: 3 });
    expect(s.textSpeed).toBe(INSTANT_SPEED);
    expect(s.musicVolume).toBe(0);
    expect(s.boxOpacity).toBe(0.4);
    expect(s.autoDelay).toBe(3);
  });

  it('rejects wrong types and unknown choices', () => {
    const s = sanitizeSettings({ textSpeed: '60', font: 'comic', motion: 'reduced', soundVolume: NaN });
    expect(s.textSpeed).toBe(DEFAULT_SETTINGS.textSpeed);
    expect(s.font).toBe('serif');
    expect(sanitizeSettings({ font: 'legible' }).font).toBe('legible');
    expect(sanitizeSettings({ font: 'dyslexic' }).font).toBe('dyslexic');
    expect(s.motion).toBe('reduced');
    expect(s.soundVolume).toBe(DEFAULT_SETTINGS.soundVolume);
  });

  it('keeps master volume, mutes, voices per character and which questions to ask', () => {
    const s = sanitizeSettings({
      masterVolume: 2, muted: { music: true, sound: 'yes' }, voiceVolumes: { rin: 0.4, 'bad id': 1, kei: 'loud' },
      voiceMuted: ['rin', 'rin', 3], confirm: { quit: false, nonsense: false },
    });
    expect(s.masterVolume).toBe(1);
    expect(s.muted).toEqual({ master: false, music: true, sound: false, voice: false });
    expect(s.voiceVolumes).toEqual({ rin: 0.4 });
    expect(s.voiceMuted).toEqual(['rin']);
    expect(s.confirm.quit).toBe(false);
    expect(s.confirm.title).toBe(true);
    expect(sanitizeSettings({}).confirm).toEqual(DEFAULT_SETTINGS.confirm);
  });
});
