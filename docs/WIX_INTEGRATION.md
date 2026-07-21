# Wix Integration — Foundation (Phase 12)

This document describes the environment-controlled data adapter, the server-side Wix client, and the connectivity health check added in Phase 12, plus what's deliberately still missing ahead of Phase 13. See [ADR-007](./adr/ADR-007-wix-integration-foundation.md) for why this shape was chosen.

**Nothing about the running application changed this phase.** Mock mode (`DATA_ADAPTER=mock`, the default) is byte-for-byte the same fixture-backed behavior Beacon has had since Phase 4. Everything below is additive: new code that exists but that no page, component, or existing service calls into yet.

## The data adapter

`lib/env.ts`'s `getDataAdapterMode()` reads `DATA_ADAPTER` and returns `'mock'` (default, if unset or empty) or `'wix'`. Any other value throws immediately with a clear message.

- **`mock`** — every `services/*` function keeps reading `services/__mocks__/fixtures.ts`'s in-memory arrays, exactly as before. No Wix environment variable is read, checked, or required.
- **`wix`** — currently enables exactly one thing: `app/api/wix-health`'s connectivity check. **No application service branches on this value yet** — `casesService`, `staffService`, etc. are entirely unaware `DATA_ADAPTER` exists. Wiring them to actually call Wix when this is set is Phase 13+ work, not this phase's.

## The server-side Wix client

`lib/wixClient.ts`'s `createWixServerClient()` is the one place in the codebase that constructs a Wix SDK client, per `docs/ARCHITECTURE.md`'s existing `lib/` role ("low-level client setup... `services/` is built on top of `lib/`, not the other way around"). It uses the [API Key authorization strategy](https://dev.wix.com/docs/sdk/articles/set-up-a-client/authorization-strategies) (`ApiKeyStrategy` from `@wix/sdk`) with a site-level `siteId` — the correct strategy for admin/server-side operations in a self-managed headless project, per Wix's own guidance, as opposed to the OAuth strategy (which is for visitor/member-facing flows we don't need yet).

Only the `siteProperties` module (`@wix/business-tools`) is wired in. No Data/CMS module is installed or imported — this phase doesn't touch business data at all, by design ("do not create the full production data schema yet").

### Security boundary

`lib/wixClient.ts` reads `WIX_API_KEY`, a secret, via `lib/env.ts`. **It must only ever be imported from server-side code** — currently, exclusively `app/api/wix-health/route.ts`. Next.js Route Handlers are never included in the browser bundle regardless of what they import; that's the structural guarantee this relies on today.

This phase deliberately did **not** add the `server-only` npm package (the common belt-and-suspenders guard that makes an accidental client-side import a build error instead of a silent risk). The instructions for this phase scoped new dependencies to "the Wix SDK packages required," and `server-only` isn't one — so it's a documented gap, not an oversight: **recommended as the first thing to add in Phase 13**, once more than one file needs to respect this boundary and the discipline of "just don't import it from a Client Component" stops being enough on its own.

## The health check

`GET /api/wix-health` — the "minimal connectivity check" this phase asks for.

- In mock mode: responds immediately, `{ adapter: "mock", connected: true, message: "..." }`, no Wix call attempted.
- In wix mode: attempts to construct a client and call `getSiteProperties()` (the lightest available authenticated read — site display name, contact/schedule info a Wix user already entered in their own dashboard; not a Data/CMS call, and nothing decedent/case-related). Returns only `siteDisplayName` on success, nothing else from the full response. On any failure (missing config, bad key, network error), returns HTTP 503 with a plain-text `error` message — never a raw exception, never the API key itself.

This was verified with unit tests (`app/api/wix-health/route.test.ts`) covering: mock mode responds without a Wix call; wix mode with missing config fails cleanly with a message naming exactly what's missing; the response body never contains a raw secret value even on failure.

**Live-verified (2026-07-21):** with a real `WIX_API_KEY` and `WIX_SITE_ID` set in a local, gitignored `.env.local`, `GET /api/wix-health` was run against the actual Beacon Development Wix project and returned `HTTP 200`, `{"adapter":"wix","connected":true,"siteDisplayName":"Beacon Development"}` — confirming the server can authenticate to the real project and that `WIX_SITE_ID` resolves correctly. No Wix resource was created or modified in the course of this check; it only calls the read-only `getSiteProperties()` path described above. The real API key used for this test was never printed, logged, or committed — it exists only in the untracked `.env.local` on the machine where the check was run.

**Still not verified:** anything beyond this one read-only site-properties call. No Data/CMS collection has been created or queried, and this check says nothing about the OAuth member-login path (`WIX_OAUTH_CLIENT_ID`) — see `docs/AUTHENTICATION.md`'s "Known limitations" for that.

## Environment configuration

### Local development

Copy `.env.example` to `.env.local` (already gitignored — confirmed, see below). Leave `DATA_ADAPTER` unset or `mock` for normal frontend work; nothing else in this section is needed.

To test the Wix connection locally:

1. Generate an API Key yourself in the Wix dashboard's [API Keys manager](https://manage.wix.com/account/api-keys) — **Claude does not create this**; it's a credential you generate and hold. Grant it whatever minimal scope is required for Site Properties (business-info read access).
2. Find your Beacon Development project's site ID (appears after `/dashboard/` in the project's dashboard URL).
3. Set in `.env.local`:
   ```
   DATA_ADAPTER=wix
   WIX_API_KEY=<the key you generated>
   WIX_SITE_ID=<Beacon Development's site id>
   ```
4. `npm run dev`, then visit `http://localhost:3000/api/wix-health` — expect `{"adapter":"wix","connected":true,"siteDisplayName":"..."}`.

### Preview deployments (e.g., Vercel preview builds)

Recommended: leave `DATA_ADAPTER` unset (mock mode) for preview builds, same as production-adjacent testing shouldn't touch a real Wix project by default. If you do want to preview-test the Wix connection, use a **separate, non-production** Wix API key scoped only to Beacon Development (or a dedicated staging project), set as a Vercel Preview-scoped environment variable — never reuse a production key in a preview environment.

### Production

Set `DATA_ADAPTER`, `WIX_API_KEY`, `WIX_SITE_ID` (and `WIX_ACCOUNT_ID` if a future phase needs account-level calls) via the hosting platform's environment variable UI (e.g., Vercel Project Settings → Environment Variables), scoped to Production only. Never commit real values — `.env.local`/`.env` are gitignored specifically so this isn't possible by accident (verified below).

## Authentication decisions needed for Phase 13

This phase deliberately stopped at "prove the server can talk to Wix." It does **not** decide:

- **Which authorization strategy visitor/member-facing features will use.** API Key (admin) is correct for a background connectivity check, but per Wix's own guidance, it's explicitly the wrong strategy for anything acting on behalf of a specific visitor or staff member — that needs OAuth. Phase 13 needs to decide how Beacon's staff sessions map onto a Wix identity (Wix Members? A first-party session backed by an API-Key-authenticated backend, per the original `docs/ARCHITECTURE.md` plan? Something else?).
- **Whether `organizationId` maps onto a Wix site ID 1:1, or onto something else** once more than one organization is real. Today there's exactly one site (Beacon Development) and one mock `organizationId` — the multi-tenant story from `docs/adr/ADR-002-multi-tenant-architecture.md` and this phase's `WIX_SITE_ID` haven't been reconciled yet.
- **How `organizationId` gets authenticated, not just carried.** This phase's instructions are explicit that a browser-supplied `organizationId` must never be trusted as authorization on its own — Phase 13's real services need a server-side source of truth (a session, a token, something the client can't forge) that a request's claimed `organizationId` gets checked against, not merely read from.
- **Which Wix data modules the production schema actually needs**, and whether the existing `docs/CMS_SCHEMA.md` (written well before Phase 11's workflow-template model existed) still matches what will actually be built.
- **The `server-only` package** — recommended addition once real services start importing `lib/wixClient.ts`.

## Confirmed: `.gitignore` protects local environment and Claude config files

- `.env` and `.env*.local` were already gitignored before this phase (confirmed by reading `.gitignore` directly, not assumed).
- No `.claude/` directory or `.mcp.json` file exists anywhere in this repository — the MCP server configuration created in an earlier session lives entirely in the user's home directory (`~/.claude.json`), structurally outside this repo's working tree, so it cannot be committed here regardless of `.gitignore`.
- `.claude/` and `.mcp.json` were added to `.gitignore` anyway, defensively, in case a project-scoped MCP config is ever added to this repo later.
