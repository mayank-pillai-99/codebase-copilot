import { describe, expect, it } from 'vitest';
import { forwardingHeaders, visitorIp } from './forwarding';

describe('visitorIp', () => {
  it('prefers x-real-ip, then the first x-forwarded-for entry', () => {
    expect(visitorIp(new Headers({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(visitorIp(new Headers({ 'x-forwarded-for': '203.0.113.8, 10.0.0.1' }))).toBe(
      '203.0.113.8',
    );
    expect(visitorIp(new Headers())).toBeNull();
  });
});

describe('forwardingHeaders', () => {
  const incoming = new Headers({ 'x-real-ip': '203.0.113.7' });

  it('signs the visitor IP with the shared secret', () => {
    expect(forwardingHeaders(incoming, 's3cret')).toEqual({
      'x-client-ip': '203.0.113.7',
      'x-proxy-secret': 's3cret',
    });
  });

  it('forwards nothing without a secret or an IP', () => {
    expect(forwardingHeaders(incoming, undefined)).toEqual({});
    expect(forwardingHeaders(new Headers(), 's3cret')).toEqual({});
  });
});
