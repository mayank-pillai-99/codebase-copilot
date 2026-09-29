import { describe, expect, it } from 'vitest';
import { loginRequestSchema, registerRequestSchema } from './auth';

describe('auth request schemas', () => {
  it('normalizes email case and whitespace', () => {
    const parsed = registerRequestSchema.parse({
      email: '  Ada@Example.COM ',
      password: '12345678',
    });
    expect(parsed.email).toBe('ada@example.com');
  });

  it('rejects invalid emails and short passwords with readable messages', () => {
    const result = registerRequestSchema.safeParse({ email: 'nope', password: 'short' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual([
      'Enter a valid email address',
      'Password must be at least 8 characters',
    ]);
  });

  it('does not apply new-password rules at login', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(true);
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});
