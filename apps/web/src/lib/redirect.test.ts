import { describe, expect, it } from 'vitest';
import { safeNextPath } from './redirect';

describe('safeNextPath', () => {
  it('keeps same-site paths, including query strings', () => {
    expect(safeNextPath('/repos')).toBe('/repos');
    expect(safeNextPath('/repos/abc?tab=chat')).toBe('/repos/abc?tab=chat');
  });

  it.each([
    ['absolute URL', 'https://evil.com'],
    ['protocol-relative URL', '//evil.com'],
    ['backslash trick', '/\\evil.com'],
    ['relative path', 'repos'],
    ['javascript URL', 'javascript:alert(1)'],
    ['missing', undefined],
    ['array from repeated params', ['/a', '/b']],
  ])('falls back to /repos for %s', (_label, next) => {
    expect(safeNextPath(next)).toBe('/repos');
  });
});
