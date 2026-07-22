# ADR-013: Wix Case Read Integration

**Status:** Accepted
**Date:** 2026-07-22

## Context

Following Phase 15A (organizations) and Phase 15B (workflow templates), cases remained entirely mock-backed regardless of `DATA_ADAPTER`. Phase 15C needed the same real-Wix-read treatment for `services/casesService.ts`'s `list()`/`get()`, while leaving `create()`/`update()` — and every mutation hook built on them (`useCreateCase`, `useCaseMutations`, `useAdvanceCaseStage`) — completely untouched, per this phase's explicit scope ("writes remain mock-only until Phase 16").

**The complication Phase 15A/15B didn't have:** `organizationsService`/`workflowTemplatesService` are pure-read, so making them always `fetch()` a Route Handler (letting only the server-side route read the real `DATA_ADAPTER`, since that env var isn't visible client-side) was a clean, side-effect-free change. `casesService` is different — today, `list()`, `get()`, `create()`, and `update()` all run entirely client-side against one shared in-memory array (`services/__mocks__/fixtures.ts`'s `caseFixtures`). Making `list()`/`get()` always fetch a server-side Route Handler would move their reads to a *separate* server-side module instance of `caseFixtures` — one `create()`/`update()` (staying client-side, unchanged) would never write to. In pure `DATA_ADAPTER=mock`, this would have broken the existing, working "create a case, see it appear immediately" flow — a real regression against "existing mock case behavior must remain completely unchanged," discovered and flagged before any code was written.

## Decision

Resolve this by passing the server-resolved `DATA_ADAPTER` value down through the *existing* organization context, rather than introducing a new public env var or a new context:

- `app/(portal)/layout.tsx` (already an async Server Component resolving `organizationId` server-side) also calls `getDataAdapterMode()` and passes the result into `OrganizationProvider` as a new `dataAdapterMode` prop.
- `hooks/useOrganization.tsx`'s context value gains this field. `types/organization.ts`'s `OrganizationContext` type itself is **unchanged** (`{ organizationId: string }`) — every other service (`staffService`, `tasksService`, `workflowTemplatesService`) still declares and receives exactly that shape; the extra field is additive on the actual object, invisible to callers that don't ask for it.
- `hooks/useCases.ts`/`useCase.ts` read `organization.dataAdapterMode` and pass it as a new, explicit, defaulted (`= 'mock'`) parameter into `casesService.list()`/`get()`.
- Inside those two functions: `mock` → the exact same fixture-filtering code that ran before this phase (zero behavior change, zero network call, still sharing state with `create()`/`update()`); `wix` → `fetch()`s new Route Handlers (`app/api/cases/route.ts`, `app/api/cases/[caseId]/route.ts`), which alone talk to Wix, mapped via `lib/wixCaseMapper.ts`.

`create()`/`update()` are entirely unmodified — same signatures, same client-side `caseFixtures` mutation, same callers.

## Consequences

- Mock mode (`DATA_ADAPTER=mock`) is provably unchanged: the code path `list()`/`get()` take is byte-for-byte the pre-Phase-15C implementation.
- **A known, accepted, documented limitation**: while `DATA_ADAPTER=wix`, a case created via the New Case modal still writes only to the client-side mock `caseFixtures` (since `create()` is untouched) and will **never** appear in a subsequent Wix-sourced `list()`/`get()` call — it was never written to Wix. This isn't something this phase resolves; it's an inherent consequence of "reads from Wix, writes deferred to Phase 16," true regardless of how the read path was implemented.
- `OrganizationContext`'s type staying unchanged means this is a low-blast-radius change: no other service's call sites needed to change, and TypeScript's structural typing lets `useOrganization()`'s wider actual return value satisfy every narrower `OrganizationContext`-typed parameter without modification.
- `casesService.matchesSearch` was made an exported function (previously private to the file) so `app/api/cases/route.ts`'s mock-mode branch can reuse the identical search logic rather than duplicating it — avoiding drift between the client-side and server-side mock-mode implementations of the same rule.
- The Route Handlers' own mock-mode branches are, in practice, dead code from the running app's perspective (the client never calls them while `dataAdapterMode === 'mock'`, since `casesService.list()`/`get()` short-circuit locally first) — kept anyway for defense-in-depth and independent testability, matching every other Phase 15 Route Handler's symmetric shape.
- TanStack Query keys (`['cases', organizationId, filters]`, `['case', organizationId, caseId]`) are unchanged — `dataAdapterMode` is a single deployment-wide setting, invariant for the lifetime of a client session, unlike `organizationId` (which genuinely varies per session/tenant); including it in the cache key would add nothing.
- Identifier handling for `cases`: `beaconCaseId` → `Case.id`; `caseHandlerId` → `Case.assignedStaffId` (renamed); `currentStage` → `Case.rawStage` (renamed); `isArchived` → `Case.isDeleted` (renamed); `intakeOwnerId`/`createdBy` pass through unchanged, still carrying the unresolved identity-space fork noted in Phase 14A's `docs/WIX_DATA_SCHEMA.md`. `workflowSnapshot` is validated as a well-formed `CaseWorkflowSnapshot` shape and passed through **unmutated** — preserving that field's immutability guarantee is the entire point of it existing. A case record with a missing or malformed workflow snapshot is excluded from results (mapper returns `null`), not returned broken — the same application-integrity reasoning ADR-012 established for workflow templates with zero versions.
- No task relationship exists on `Case` itself (the reverse link lives on the `tasks` collection, out of this phase's scope — Phase 15D).

## Alternatives Considered

- **Introduce `NEXT_PUBLIC_DATA_ADAPTER`** so client-side code could read the mode directly: rejected — already rejected once in Phase 15A's ADR-010 for duplicating configuration; the context-passing approach achieves the same result without a second variable to keep in sync.
- **Move `create()`/`update()` to Route Handlers too**, so all four case operations share one server-side source of truth: rejected for this phase — explicitly out of scope ("do not implement create/update case"), and unnecessary once the context-passing fix resolves the actual regression risk (mock-mode consistency) without touching write code at all.
- **Accept the mock-mode regression** (reads via a route, writes via the client, silently inconsistent): rejected outright — directly violates "existing mock case behavior must remain completely unchanged," a hard requirement repeated across every Phase 15 sub-phase.
