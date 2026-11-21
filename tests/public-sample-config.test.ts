import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type SampleConfig = { services: Array<{ url: string }> };
const sample = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/services.json'), 'utf8'),
) as SampleConfig;

function expectSafeSampleUrl(url: string) {
  const parsed = new URL(url);
  expect(['http:', 'https:']).toContain(parsed.protocol);
  expect(
    parsed.hostname === 'example.test' || parsed.hostname.endsWith('.example.test'),
  ).toBe(true);
  expect(parsed.username === '' && parsed.password === '').toBe(true);
  expect(parsed.pathname === '/').toBe(true);
  // Comparing the full normalized URL also rejects empty query/fragment markers.
  expect(parsed.href === `${parsed.origin}/`).toBe(true);
}

describe('public sample service URLs', () => {
  it('uses reserved example.test hosts for every service URL', () => {
    expect(sample.services.length).toBeGreaterThan(0);
    for (const { url } of sample.services) {
      expectSafeSampleUrl(url);
    }
  });

  it.each([
    ['HTTP root', 'http://example.test'],
    ['HTTPS root', 'https://example.test/'],
    ['reserved subdomain', 'https://service.example.test/'],
    ['explicit port', 'http://service.example.test:8080/'],
  ])('accepts a valid %s URL', (_label, url) => {
    expect(() => expectSafeSampleUrl(url)).not.toThrow();
  });

  it.each([
    ['username', 'https://fixture-user@example.test/'],
    ['password', 'https://:fixture-pass@example.test/'],
    ['credentials', 'https://fixture-user:fixture-pass@example.test/'],
    ['path', 'https://example.test/service'],
    ['query', 'https://example.test/?fixture=value'],
    ['fragment', 'https://example.test/#fixture'],
    ['empty query', 'https://example.test/?'],
    ['empty fragment', 'https://example.test/#'],
  ])('rejects a URL containing %s', (_label, url) => {
    expect(() => expectSafeSampleUrl(url)).toThrow();
  });
});
