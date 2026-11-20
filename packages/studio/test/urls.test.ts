import { describe, expect, it } from 'vitest';
import { isExternalUrl, isLocalUrl } from '../src/urls.ts';

describe('what Studio windows may show', () => {
  it('keeps the launcher, editor and player, on the loopback address only', () => {
    expect(isLocalUrl('http://127.0.0.1:5185/')).toBe(true);
    expect(isLocalUrl('http://127.0.0.1:5174/?workspace=stage')).toBe(true);
    expect(isLocalUrl('http://127.0.0.1/')).toBe(true);
    expect(isLocalUrl('https://127.0.0.1:5185/')).toBe(false);
    expect(isLocalUrl('http://localhost:5185/')).toBe(false);
    expect(isLocalUrl('http://127.0.0.1.example.com/')).toBe(false);
    expect(isLocalUrl('http://user@127.0.0.1:5185/')).toBe(false);
    expect(isLocalUrl('file:///C:/Windows/')).toBe(false);
    expect(isLocalUrl('not a url')).toBe(false);
  });

  it('sends web and mail links to the system, and nothing else', () => {
    expect(isExternalUrl('https://github.com/')).toBe(true);
    expect(isExternalUrl('http://example.com/')).toBe(true);
    expect(isExternalUrl('mailto:someone@example.com')).toBe(true);
    expect(isExternalUrl('http://127.0.0.1:5185/')).toBe(false);
    expect(isExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isExternalUrl('ms-settings:privacy')).toBe(false);
    expect(isExternalUrl('javascript:alert(1)')).toBe(false);
  });
});
