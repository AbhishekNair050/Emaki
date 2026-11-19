import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { isLocalHost, localHostsOnly } from '../src/host-guard.ts';

describe('local hosts only (DNS rebinding)', () => {
  it('lets in this computer by name or address, on any port', () => {
    for (const h of ['localhost:5174', 'LOCALHOST', 'editor.localhost:5174', '127.0.0.1:5173', '192.168.1.20:5174', '[::1]:5174', '[fe80::1]']) {
      expect(isLocalHost(h), h).toBe(true);
    }
  });

  it('turns away any other domain, even one pointed at 127.0.0.1', () => {
    for (const h of ['evil.example:5174', 'localhost.evil.example', '127.0.0.1.nip.io:5174', 'example.com', '', undefined]) {
      expect(isLocalHost(h), String(h)).toBe(false);
    }
  });

  it('follows Vite’s allowedHosts', () => {
    expect(isLocalHost('dev.example.com', ['dev.example.com'])).toBe(true);
    expect(isLocalHost('a.studio.test:80', ['.studio.test'])).toBe(true);
    expect(isLocalHost('studio.test', ['.studio.test'])).toBe(true);
    expect(isLocalHost('other.test', ['.studio.test'])).toBe(false);
  });

  it('answers 403 before any route runs', () => {
    const run = (host: string, allowed?: readonly string[] | true) => {
      let passed = false;
      const res = { statusCode: 200, setHeader() {}, end() {} } as unknown as ServerResponse;
      localHostsOnly(allowed)({ headers: { host } } as IncomingMessage, res, () => { passed = true; });
      return passed ? 'next' : res.statusCode;
    };
    expect(run('localhost:5174')).toBe('next');
    expect(run('attacker.example:5174')).toBe(403);
    expect(run('attacker.example:5174', true)).toBe('next');
  });
});
