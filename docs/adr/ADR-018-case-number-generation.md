# ADR-018: Case Number Generation

**Status:** Accepted
**Date:** 2026-07-23

## Context

Beacon needed a human-facing, permanent case identifier — `B{YYYY}-{###}` (e.g. `B2026-001`) — distinct from the internal `Case.id` (a UUID in Wix mode, an opaque small number in mock mode), auto-generated on creation, always read-only, never reused, and guaranteed unique even under concurrent case creation.

## Architecture reviewed

- `types/case.ts`'s `Case` (no existing case-number-shaped field), `NewCaseInput`/`CaseUpdate` (the existing compile-time-plus-runtime immutability pattern already used for `intakeOwnerId`, extended here for `caseNumber`).
- `services/casesService.ts`'s mock `create()`/`update()` (client-side, single-threaded — no real concurrency to guard against).
- `app/api/cases/route.ts`'s `POST` (the Wix-mode create path — the one place genuine concurrent writers are possible).
- `docs/WIX_DATA_SCHEMA.md`'s already-recorded, previously-unapplied plan: set a Wix item's own system `_id` to its Beacon domain id at insert time, avoiding a 4th collection index Wix Data doesn't allow (`cases`/`tasks` already do this for `beaconCaseId`/`beaconTaskId`, established in Phase 16).
- Wix's REST API surface for atomic operations, confirmed **empirically against the live Wix project**, not assumed:
  - `patchDataItem`'s `INCREMENT_FIELD` action atomically increments a numeric field — this is Wix Data's actual concurrency-safe primitive (no multi-statement "transaction" API is exposed over REST, but a single atomic field increment is the "equivalent concurrency-safe mechanism" this feature calls for).
  - A patch against a nonexistent item returns **HTTP 404** (`WDE0073`).
  - An insert with a colliding `_id` returns **HTTP 409** (`WDE0074`).
  - Both confirmed via live `curl` calls against a real (throwaway, since-deleted) test collection before any code was written.

## Decision

### Format (domain/cases/caseNumber.ts)

`formatCaseNumber(year, sequence)` → `` `B${year}-${String(sequence).padStart(3, '0')}` ``; `parseCaseNumber` is its inverse. This is the single source of truth every generator (mock and Wix) and any future consumer (reports, exports, notifications) must import — "do not duplicate the numbering logic." Lives in `domain/` (a Beacon/funeral-home business identifier), not `utils/` (generic helpers), per `docs/adr/ADR-004-domain-layer.md`.

### Mock-mode generation (services/casesService.ts)

A plain scan of `caseFixtures` for the highest existing sequence in the given organization+year, +1. Mock case creation is single-threaded (one browser tab, no real concurrent writers), so this is genuinely safe without an atomic mechanism — the concurrency-safety requirement only binds the real, multi-client Wix path. The 8 pre-existing seed cases were backfilled `B2026-001` through `B2026-008` in seed order (the same "historical record, not fabricated" treatment already applied to `createdBy`/`intakeOwnerId` on those same fixtures).

### Wix-mode generation (lib/wixCaseNumberSequence.ts + a new `caseSequences` collection)

One row per organization+year, `_id = {organizationId}-{year}`. `reserveNextCaseNumber`:

1. **Common path:** an atomic `INCREMENT_FIELD` patch on the existing row. The assigned number is the *pre-increment* value (the row always holds "the next number to hand out," never "the last one given out").
2. **Bootstrap path** (the row doesn't exist — the year's first case for this organization): the patch 404s, so the row is created directly via insert, claiming sequence 1 and leaving `nextSequence: 2` for the next claimant.
3. **Bootstrap race** (two requests both hit step 2 concurrently): only one insert can succeed (Wix's own `_id` uniqueness); the loser's insert 409s, and it falls back to the atomic-increment path from step 1, which is now safe since the row exists.

No two callers can ever be handed the same number, at any concurrency level, without a multi-statement transaction — a single atomic field increment, plus an `_id`-uniqueness-arbitrated bootstrap, is sufficient. `lib/wixDataApi.ts` gained a `WixDataApiError` (carrying the real HTTP status) so this branching is done on `error.status`, not by string-matching an error message — additive to every existing function's thrown-message format, so no prior test assertion needed to change.

`app/api/cases/route.ts`'s `POST` calls `reserveNextCaseNumber(organizationId, currentYear)` — `organizationId` is always the server-authorized value from `requireAuthorizedOrganization`, never client-supplied; there is no `caseNumber` field in the request body at all, so there's nothing for a client to smuggle in even if it tried (confirmed by a dedicated test).

### Immutability

`caseNumber` is excluded from `NewCaseInput` (never client-suppliable at creation — it's server-generated after the fact) and from `CaseUpdate` (excluded at the type level, same as `workflowTemplateId`/`intakeOwnerId`/etc.). Two runtime backstops mirror the existing `intakeOwnerId` pattern exactly:
- Mock mode: `domain/cases/caseNumber.ts`'s `assertCaseNumberUnchanged`, called by `casesService.update()` before applying any patch.
- Wix mode: `lib/wixCaseMapper.ts`'s `validateAndPickCaseUpdate` simply never includes `caseNumber` in its allowlist — a patch body containing it is silently stripped, never applied, regardless of an `as any` cast bypassing TypeScript.

### Deletion / never-reused guarantee

Beacon already never hard-deletes a case (`Case.isDeleted`, soft-delete only, predating this feature). Because the sequence counter only ever increments — never decrements, never reused on delete/archive — a case's number remains permanently assigned even after it's archived, satisfying "Case Numbers are never reused" and "if permanent deletion is ever added for Super Admins, the deleted Case Number must still remain reserved" **structurally**, with no additional code needed: there is no code path anywhere that could return a previously-assigned sequence to the pool.

### UI

- **Case Detail** (`CaseHeader.tsx`): now shows `Case #{caseNumber}` instead of the internal id — the internal id is still used for routing (`/cases/{id}`), just never displayed.
- **Case lists** (`AllCasesList`, `StageFilteredPanel`, `NeedsAttentionPanel`): each row now shows the Case Number alongside the decedent name. All three "Item" types are populated by spreading a `CaseViewModel` directly (an existing structural-typing pattern in `app/(portal)/dashboard/page.tsx`), so adding `caseNumber` to `CaseViewModel`/`domain/cases/viewModel.ts` was the only wiring needed — no page-level changes.
- **Global search** (`casesService.ts`'s `matchesSearch`): now matches on `caseNumber` (case-insensitive substring), additive to the existing decedentName/phone/id checks.
- **Printable documents** (`utils/print.ts`'s `printTextLog`/`printFile`): both gained a required `caseNumber` parameter, now shown alongside the case name in every printed Case Log, Activity Log, and document placeholder.

## Consequences

- Read-after-write works exactly like every other Phase 16 field: a case created via `POST /api/cases` immediately returns its real `caseNumber`, mapped back through `mapWixCaseItem` unchanged.
- **A field the mock and Wix paths compute differently by necessity** (a plain scan vs. an atomic Wix collection) but format identically (`formatCaseNumber`, shared) — consistent with how mock/Wix id-generation has always differed (`String(1000+length+42)` vs. `crypto.randomUUID()`) while conforming to the same domain shape.
- One new Wix collection (`caseSequences`) exists solely to serve this feature; it has no read path, no client-facing service, and is invisible to every consumer except `lib/wixCaseNumberSequence.ts`.

## Alternatives Considered

- **Scan the `cases` collection itself for the max existing caseNumber, +1, at creation time** (mirroring the mock-mode approach): rejected outright — this is exactly the naive, non-concurrency-safe approach the feature's own requirements warn against; two simultaneous creations reading the same "current max" would compute and assign the identical next number.
- **A single global counter row (no per-organization split)**: rejected — case numbers are scoped per organization by the feature's own spec ("per calendar year" implicitly per-tenant, since two organizations' case counts are unrelated), and a shared row would serialize unrelated organizations' case creation against one another for no benefit.
- **Client-generated case numbers (e.g., a UUID or a client-computed sequence)**: rejected outright — explicitly forbidden ("users must never manually enter or edit the Case Number"; a client-computed value is exactly the kind of untrusted input the rest of this project's Wix-write architecture (Phase 16, ADR-016) already refuses to trust for anything security- or identity-relevant).
