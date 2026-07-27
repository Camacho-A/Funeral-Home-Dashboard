import { NextResponse } from 'next/server';

/**
 * Phase 21 security correction (2026-07-25). Next.js Server Actions get
 * built-in Origin-header verification for free (see app/login/actions.ts's
 * own long-standing comment on this) — but that protection is specific to
 * the Server Action wire protocol. Plain `app/api/*` Route Handlers get
 * none of it: a state-changing Route Handler that only checks for a valid
 * session cookie is vulnerable to a classic CSRF attack, since browsers
 * attach cookies to cross-site requests automatically. Every
 * cookie-authenticated, state-changing Route Handler in this codebase
 * must call this first (see each route's own call site).
 *
 * The check: the request must carry an `Origin` header (browsers always
 * send one on state-changing cross-origin-*capable* requests — its
 * absence is itself rejected, not treated as "same-origin by default"),
 * and that Origin's host must exactly match the request's own `Host`
 * header. A same-site form post or `fetch()` from Beacon's own pages
 * satisfies this trivially; a cross-site page trying to trigger a
 * state-changing request against a signed-in user's session cannot make
 * the browser send an `Origin` matching Beacon's own host.
 *
 * **No trusted-proxy forwarded-host header is honored.** `X-Forwarded-Host`
 * (or similar) is attacker-controllable on an ordinary request unless a
 * specific upstream proxy is configured to strip/overwrite it before this
 * app ever sees it — no such proxy is configured for this deployment today,
 * so trusting that header would let an attacker simply set it to Beacon's
 * own hostname and bypass this check entirely. If a real reverse-proxy
 * topology is introduced later, this function is the one place to update,
 * deliberately, comparing against a specific known-trusted forwarded value
 * — not a blanket trust of any `X-Forwarded-*` header. See this module's
 * own test file for the empirical confirmation that `X-Forwarded-Host`
 * currently has no bypass effect.
 *
 * Returns a 403 `NextResponse` to return immediately when the check fails,
 * or `null` when the request passes and the caller should proceed.
 */
export function requireSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  if (!origin) {
    return NextResponse.json({ error: 'Missing Origin header.' }, { status: 403 });
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return NextResponse.json({ error: 'Invalid Origin header.' }, { status: 403 });
  }

  if (!host || originHost !== host) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  }

  return null;
}
