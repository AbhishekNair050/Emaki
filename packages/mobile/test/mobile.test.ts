import { describe, expect, it } from 'vitest';
import { capacitorConfig, defaultAppId, isAppId, semver } from '../src/export.ts';

describe('mobile export helpers', () => {
  it('make a valid app id from any title', () => {
    expect(defaultAppId('The Keeper of Gullwing Point')).toBe('com.emaki.thekeeperofgullwingpoint');
    expect(defaultAppId('7 Days: Café!')).toBe('com.emaki.dayscafe');
    expect(defaultAppId('ねこ')).toBe('com.emaki.game');
    for (const t of ['The Keeper of Gullwing Point', '7 Days: Café!', 'ねこ']) expect(isAppId(defaultAppId(t))).toBe(true);
  });

  it('accept only ids both stores take', () => {
    expect(isAppId('com.studio.game')).toBe(true);
    expect(isAppId('com.studio.my_game2')).toBe(true);
    expect(isAppId('game')).toBe(false);
    expect(isAppId('com.2studio.game')).toBe(false);
    expect(isAppId('com.studio-x.game')).toBe(false);
  });

  it('versions become x.y.z', () => {
    expect(semver('0.3')).toBe('0.3.0');
    expect(semver('2')).toBe('2.0.0');
    expect(semver('1.2.3-beta')).toBe('1.2.3');
    expect(semver(undefined)).toBe('1.0.0');
  });

  it('configure a full-screen, black-backed app', () => {
    expect(capacitorConfig({ appId: 'com.a.b', title: 'B' })).toMatchObject({
      appId: 'com.a.b', appName: 'B', webDir: 'www', backgroundColor: '#000000',
    });
  });
});
