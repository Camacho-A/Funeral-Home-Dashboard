import { describe, expect, it } from 'vitest';
import { isAuthorizationError } from './providers';

/**
 * Manors go-live hardening. Production testing showed an unauthorized
 * accounting query retried on a 403 for ~9s/12 attempts before the UI
 * reached its "not authorized" state — react-query's default `retry`
 * doesn't distinguish a permission failure (which will never succeed on
 * retry) from a transient one. `isAuthorizationError` is the guard
 * app/providers.tsx's shared QueryClient uses to skip retries only for
 * 401/403; every other error keeps the library's normal behavior.
 */
describe('isAuthorizationError', () => {
  it('recognizes a 401 status on the thrown error', () => {
    const error = Object.assign(new Error('nope'), { status: 401 });
    expect(isAuthorizationError(error)).toBe(true);
  });

  it('recognizes a 403 status on the thrown error', () => {
    const error = Object.assign(new Error('nope'), { status: 403 });
    expect(isAuthorizationError(error)).toBe(true);
  });

  it('does not treat a 500 as an authorization error', () => {
    const error = Object.assign(new Error('server error'), { status: 500 });
    expect(isAuthorizationError(error)).toBe(false);
  });

  it('does not treat a plain Error with no status as an authorization error', () => {
    expect(isAuthorizationError(new Error('network blip'))).toBe(false);
  });

  it('handles a non-Error thrown value safely', () => {
    expect(isAuthorizationError('a string error')).toBe(false);
    expect(isAuthorizationError(null)).toBe(false);
    expect(isAuthorizationError(undefined)).toBe(false);
  });
});
