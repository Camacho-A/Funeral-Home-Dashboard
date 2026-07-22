# ADR-011: Auth/Data Adapter Separation

**Status:** Accepted
**Date:** 2026-07-22

## Context

Through Phase 15A, a single environment variable, `DATA_ADAPTER`, controlled two genuinely independent concerns: which backend `services/*` read/write against, and which login provider `app/login` used (`app/login/actions.ts`/`app/login/page.tsx` both branched on `getDataAdapterMode()`). This made one real, useful local-development combination impossible to express: testing Wix-backed data reads (`DATA_ADAPTER=wix`, Phase 15A) while still signing in with mock credentials, since setting `DATA_ADAPTER=wix` also forced the login form into real-Wix-member mode — a mode that can't actually work yet, since no real Wix member account exists (see `docs/AUTHENTICATION.md`'s "Wix dashboard setup" section) and `WIX_OAUTH_CLIENT_ID`'s current value is itself unverified. In practice this meant Phase 15A's own Wix-backed organization read could only be exercised by curl, not through the actual running app's login flow.

## Decision

Introduce `AUTH_ADAPTER` (`lib/env.ts`'s `getAuthAdapterMode()`), mirroring `getDataAdapterMode()`'s exact shape (defaults to `"mock"` if unset, throws a clear error on any other value) but controlling authentication only. `app/login/actions.ts`'s `loginAction` and `app/login/page.tsx` now read `getAuthAdapterMode()` instead of `getDataAdapterMode()` for their branching decision — nothing else about either file changed. `DATA_ADAPTER` no longer has any bearing on which login provider is used; it controls data access exclusively.

No authentication logic itself was touched: `lib/auth/mockAuth.ts`'s `verifyMockCredentials`, `lib/auth/wixAuth.ts`'s `loginWithWix`, `lib/auth/session.ts`, `middleware.ts`, and `lib/auth/authorize.ts` are all byte-for-byte unchanged. This was purely a configuration-and-branching change, not a rewrite of either login mechanism.

The login page's mock-mode button label changed from "Sign in (mock mode)" to **"Sign In (Development)"** — a small, deliberate wording change requested alongside the adapter split, since the button no longer implies anything about the *data* adapter, only that this is a development-only credential path.

## Consequences

- All four `(DATA_ADAPTER, AUTH_ADAPTER)` combinations are now valid and independently meaningful:
  - `mock, mock` — full mock mode, the original default behavior, byte-for-byte unchanged.
  - `wix, mock` — **the new, primary local-development combination**: real Wix-backed organization reads, sign in with the existing mock credentials (`dana@managedcremations.test` / `mock-password-not-real`). This is what Phase 15A's Wix read integration can now actually be exercised through in the running app, not just via curl.
  - `mock, wix` — mock data, real Wix member login — useful for testing the login flow in isolation before Wix-backed data reads are needed for a given task.
  - `wix, wix` — the eventual production configuration. Not yet usable end-to-end: no real Wix member account exists, and `WIX_OAUTH_CLIENT_ID`'s current value is unverified (see `docs/AUTHENTICATION.md`'s known limitations).
- `getWixOAuthClientId()`'s error message was corrected to say `AUTH_ADAPTER=wix requires WIX_OAUTH_CLIENT_ID` instead of `DATA_ADAPTER=wix requires...` — this was already inaccurate before this phase in the sense that the OAuth client ID is exclusively an authentication concern; the error message just hadn't been reconciled with that fact until now.
- `getWixServerConfig()` (the `WIX_API_KEY`/`WIX_SITE_ID` pair) is untouched and still correctly gated by `DATA_ADAPTER` — that pair authenticates the *data* client, not login.
- Organization membership resolution (`resolveAuthorizationContext`) is unaffected by either adapter and still always reads mock fixtures — a real Wix member logging in via `AUTH_ADAPTER=wix` still needs a membership record invented for them somehow, exactly as already documented as a known limitation in Phase 13/14's work. This ADR doesn't change that.

## Alternatives Considered

- **Keep one combined adapter variable, add a third mode (e.g. `DATA_ADAPTER=wix-data-only`)**: rejected — conflates two orthogonal concerns into an ever-growing enum instead of two independent booleans-in-disguise; doesn't scale if a third concern (e.g. document storage) needs its own adapter later.
- **Derive `AUTH_ADAPTER` from `DATA_ADAPTER` with an explicit override**: rejected — adds conditional-fallback complexity for no real benefit over two independent variables, both defaulting to `"mock"`.
- **Rename `DATA_ADAPTER` itself to something more scoped (e.g. `SERVICES_ADAPTER`)**: rejected — out of scope; `DATA_ADAPTER` already correctly described data access once `AUTH_ADAPTER` existed to take over the authentication half, and renaming it would be a larger, unnecessary diff across many files and docs for no functional gain.
