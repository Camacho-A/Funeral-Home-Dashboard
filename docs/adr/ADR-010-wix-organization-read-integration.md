# ADR-010: Wix Organization Read Integration

**Status:** Accepted
**Date:** 2026-07-22

## Context

Through Phase 14B, Beacon has real Wix Data collections (organizations, workflow templates, cases, tasks) with one seeded organization record, but no application code reads any of them — `DATA_ADAPTER=wix` only enabled Phase 12's site-properties health check. Phase 15A needed the first real read: displaying the current organization's name (Sidebar, Reports) from Wix when `DATA_ADAPTER=wix`, while every other read/write stayed on mocks, without changing the `Organization` domain type, `useOrganization()`'s existing shape, or any other service.

## Decision

Two shape decisions, both forced by constraints discovered while implementing:

1. **A Route Handler (`app/api/organizations/[organizationId]/route.ts`) sits between the client-side service and Wix, rather than `services/organizationsService.ts` branching on `DATA_ADAPTER` itself.** `organizationsService.get()` runs in the browser (called from a Client Component's `useOrganizationRecord()` hook via TanStack Query). `DATA_ADAPTER` is a plain server env var, not `NEXT_PUBLIC_*` — reading it client-side always evaluates to `undefined`, silently defaulting to `'mock'` regardless of the real server configuration. The service therefore always `fetch()`es the Route Handler; only the Route Handler (genuinely server-side) reads `getDataAdapterMode()` and decides mock vs. Wix — the same pattern `app/api/wix-health/route.ts` established in Phase 12.
2. **The Wix read uses a direct, authenticated `fetch()` against the Wix Data REST API (`lib/wixDataApi.ts`), not `@wix/data`'s SDK `items` module.** Wiring `@wix/sdk`'s `createClient()` with `@wix/data`'s `items` module reproducibly crashed at client-construction time (`isAmbassadorModule()` throwing inside `@wix/sdk-runtime`'s `wql-builder-utils.js`) — confirmed as a genuine upstream version-incompatibility bug between `@wix/sdk@1.21.13` and `@wix/data`, not a query-shape issue (it crashed even after fully deduping to a single `@wix/sdk-runtime` version). The REST endpoints used instead are the same ones already proven reliable via curl in Phases 14A/14B.

The mapping from raw Wix item to the `Organization` domain type happens in one place (`lib/wixOrganizationMapper.ts`'s `mapWixOrganizationItem`) — it reads `beaconOrganizationId`/`name`/`isActive` explicitly by field name and never treats the Wix-managed `_id` as a display name or domain identifier, consistent with every prior phase's "separate Wix record metadata from Beacon domain identifiers" principle.

## Consequences

- `services/organizationsService.ts`'s interface (`get(context): Promise<Organization | null>`) is identical regardless of adapter; `hooks/useOrganizationRecord.ts` mirrors `useStaff()`/`useCases()` exactly. No existing service, hook, or component signature changed.
- `@wix/data` was installed, found incompatible, and fully uninstalled — `package.json`/`package-lock.json` show no net diff from this phase.
- `lib/wixClient.ts` (the SDK-based client) still only wires `siteProperties`; a second, parallel mechanism (`lib/wixDataApi.ts`, raw REST) now exists for Data Items specifically. This is a real, documented inconsistency in how the app talks to Wix (SDK for site properties, REST for Data Items) — acceptable because the SDK path for Data Items is currently broken, not a stylistic preference; revisit consolidating onto one mechanism once a compatible `@wix/sdk`/`@wix/data` version pairing exists.
- Only the `organizations` collection is read from Wix. `cases`, `tasks`, `workflowTemplates`/`workflowTemplateVersions` remain entirely mock-backed regardless of `DATA_ADAPTER` — explicitly out of this phase's scope (Phase 16+).
- Writes are not affected at all — `DATA_ADAPTER=wix` only changes reads; every mutation (case creation, task updates, etc.) still goes to mock fixtures.

## Alternatives Considered

- **Branch on `DATA_ADAPTER` directly inside `organizationsService.get()`**: rejected — proven not to work, since the real env var value isn't visible in the browser bundle; would silently always take the mock path in `wix` mode.
- **Expose a `NEXT_PUBLIC_DATA_ADAPTER` mirror for client-side branching**: rejected — duplicates configuration (two variables to keep in sync) and still doesn't solve where the actual `WIX_API_KEY`-authenticated call needs to happen (server-side, regardless).
- **Debug and fix the `@wix/sdk`/`@wix/data` version incompatibility (e.g., via a patch-package or waiting for an upstream fix)**: rejected for this phase — the direct REST approach was already proven reliable in Phases 14A/14B, is simpler, and doesn't block on an upstream fix timeline. Worth revisiting once official packages are compatible.
