# ADR-007: Wix Integration Foundation

**Status:** Accepted
**Date:** 2026-07-21

## Context

Through Phase 11, Beacon is entirely a mock-data frontend: every `services/*` function reads and writes `services/__mocks__/fixtures.ts`'s in-memory arrays, and those modules are imported directly by Client Components' hooks — meaning they execute in the browser. A blank Wix Headless project ("Beacon Development") now exists, and the Wix MCP is authenticated in Claude Code for documentation/tooling access during development. Before any real service is rewritten to call Wix, the project needs a safe place for that connection to live: real credentials cannot simply be dropped into the existing service layer, because that layer's modules are bundled into client-side JavaScript today — importing an API-key-authenticated Wix SDK client there would ship the key to every visitor's browser.

## Decision

Add a data adapter switch (`DATA_ADAPTER=mock|wix`, `lib/env.ts`) that defaults to `mock` and changes nothing about existing behavior when left at that default. Add exactly one new integration surface for the `wix` value to activate: a server-side Wix client factory (`lib/wixClient.ts`, using `@wix/sdk`'s `ApiKeyStrategy` — the strategy Wix's own docs recommend for admin/server operations in a self-managed headless project) and a minimal connectivity check (`app/api/wix-health`, a Next.js Route Handler) that proves the server can authenticate, using the lightest available read (`@wix/business-tools`'s site properties) rather than any business/case data.

Both `lib/env.ts`'s Wix-config validation and `lib/wixClient.ts`'s client construction are lazy — evaluated only when a wix-mode request actually happens, never at module load — so `next build` succeeds with zero Wix environment variables set as long as `DATA_ADAPTER` stays at its default. No existing `services/*` module was touched; none of them read `DATA_ADAPTER` or import `lib/wixClient.ts`. That wiring is explicitly deferred.

## Consequences

- Mock mode is provably unaffected: no file under `services/`, `hooks/`, `components/`, or `app/(portal)/*` changed this phase, and the existing Vitest suite (41 tests) passes unchanged plus 10 new tests for the added code.
- A real Wix connection can be smoke-tested (`/api/wix-health`) before any actual data migration risk exists — useful for verifying credentials/site ID are correct in isolation from the harder work of rewriting services.
- Establishes, but does not yet enforce, a hard rule for future phases: Wix-calling code must live behind `lib/wixClient.ts` and be reached only from server-side code (Route Handlers, Server Components, Server Actions) — never from a Client Component or anything it imports. This phase's only consumer (`app/api/wix-health/route.ts`) already satisfies this by construction (Route Handlers are never bundled to the browser); Phase 13's real services will need the same discipline without that particular structural shortcut always being available, which is why `docs/WIX_INTEGRATION.md` recommends adding the `server-only` guard package at that point.
- Real, unresolved gaps deliberately left open rather than guessed at: which authorization strategy visitor/member-facing features need (OAuth, not API Key), how `organizationId` should be authenticated rather than merely trusted from the browser, and whether a Wix site ID maps 1:1 onto an `organizationId` once a second real organization exists. All three are recorded in `docs/WIX_INTEGRATION.md`'s "Authentication decisions needed for Phase 13" rather than decided here.

## Alternatives Considered

- **Wire `casesService`/etc. directly to Wix now, behind an `if (adapter === 'wix')` branch inside each service function**: rejected — those modules currently execute in the browser (imported by Client Component hooks). Branching to a real Wix SDK call inside them would require an API key to be reachable from client-side code the moment `DATA_ADAPTER=wix`, which is exactly the "secrets exposed to browser-side code" outcome this phase exists to prevent. Real service integration needs its own server-boundary redesign (Route Handlers or Server Actions calling `lib/wixClient.ts`, with hooks calling those instead of importing services directly) — correctly scoped to Phase 13, not this one.
- **Skip the mock/wix adapter switch and just add the Wix client with no gating**: rejected — this would make `next build` require real Wix credentials unconditionally, breaking "the application builds without Wix credentials when mock mode is active" and removing the ability to develop the frontend without ever touching Wix.
- **Use OAuth instead of an API Key for this phase's connectivity check**: rejected — OAuth is for visitor/member-facing identity, which nothing in this phase needs; API Key is what Wix's own documentation recommends for exactly this admin/background use case, and needing only a key + site ID (no client secret, no redirect flow) is the simpler, more appropriate fit for a one-off health check.
