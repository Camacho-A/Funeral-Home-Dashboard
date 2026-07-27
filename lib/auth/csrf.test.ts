import { describe, expect, it } from 'vitest';
import { requireSameOrigin } from './csrf';

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request('https://beacon.example.com/api/auth/change-password', {
    method: 'POST',
    headers: { host: 'beacon.example.com', ...headers },
  });
}

describe('requireSameOrigin', () => {
  it('rejects a request with no Origin header at all', () => {
    const result = requireSameOrigin(requestWithHeaders({}));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('rejects a request whose Origin host does not match the Host header (mismatched Origin/Host)', () => {
    const result = requireSameOrigin(requestWithHeaders({ origin: 'https://evil.example.com' }));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('rejects an unparseable Origin header', () => {
    const result = requireSameOrigin(requestWithHeaders({ origin: 'not-a-valid-url' }));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('allows a valid same-origin request through (returns null)', () => {
    const result = requireSameOrigin(requestWithHeaders({ origin: 'https://beacon.example.com' }));
    expect(result).toBeNull();
  });

  it('rejects a cross-site request even when it carries a valid-looking but foreign Origin', () => {
    const result = requireSameOrigin(requestWithHeaders({ origin: 'https://attacker.example.net' }));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('does not treat a matching scheme-only or port-mismatched Origin as same-origin', () => {
    // Same hostname, different port — Origin's `host` includes the port,
    // so this must still be rejected as a mismatch against the plain
    // beacon.example.com Host header.
    const result = requireSameOrigin(requestWithHeaders({ origin: 'https://beacon.example.com:8443' }));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('never trusts X-Forwarded-Host as a substitute for a matching Origin (no proxy is configured to honor it)', () => {
    // An attacker can set X-Forwarded-Host to Beacon's own hostname
    // trivially on an ordinary, un-proxied request — this must not let a
    // foreign Origin through.
    const result = requireSameOrigin(
      requestWithHeaders({ origin: 'https://attacker.example.net', 'x-forwarded-host': 'beacon.example.com' }),
    );
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});
