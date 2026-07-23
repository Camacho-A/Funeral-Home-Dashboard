# ADR-017: New Case UX Polish and Initial Note

**Status:** Accepted
**Date:** 2026-07-24

## Context

Phase 16A asked for New Case form polish (uppercase transform, MM/DD/YYYY and MM/YY input masks with calendar/month validation, a show/hide toggle replacing permanent card-field masking) plus a new optional initial-note field, saved through whatever domain/service already backs case notes — explicitly not a new or duplicate storage mechanism, and explicitly to be reported rather than worked around if that existing mechanism has no Wix write path.

## Architecture reviewed

`services/caseLogService.ts` (backing `CaseLogEntry`/`components/case/CaseLogCard.tsx`, used by every case's "Case Log" panel) is the only existing case-notes domain/service. It is **entirely mock**: no `dataAdapterMode` parameter, no Route Handler, no Wix collection. Confirmed against `docs/WIX_DATA_SCHEMA.md`, which defines exactly six Wix collections (`organizations`, `organizationMemberships`, `workflowTemplates`, `workflowTemplateVersions`, `cases`, `tasks`) and explicitly notes that `CaseLogEntries` (from the older `docs/CMS_SCHEMA.md`) remains "out of scope." This is not a gap introduced by this phase — case notes have never been Wix-backed, on any case, in any prior phase.

## Decision

**1–3. Formatting/masking** (`utils/inputMask.ts`, new): `formatDateInput`/`isValidCalendarDate` (MM/DD/YYYY, real calendar-date validation including leap years, via JS `Date`'s own month/day rollover rather than a hand-rolled days-per-month table) and `formatCardExpiryInput`/`isValidExpiryMonth` (MM/YY, month range 1-12). Both live in `utils/` (not `domain/`) as generic, funeral-home-independent formatting helpers, matching this project's existing `utils/format.ts` precedent. `NewCaseModal.tsx` applies these per field by a fixed key allowlist (`UPPERCASE_FIELD_KEYS`, `DATE_FIELD_KEYS`, `EXPIRY_FIELD_KEYS`), blurred-field error display, and blocks `canSubmit` while any date/expiry field holds a non-empty, invalid value.

**4. Card visibility.** Reverts this project's own prior (Phase 16A v1) choice to permanently unmask password-flagged fields. Fields with `IntakeFieldTemplate.password === true` (`cardNumber`, `cardCvv`) now render masked by default with an independent per-field Show/Hide `<button>` — local `revealedFields` state in `NewCaseModal.tsx`, no change to the template's `password` flag itself, no shared `TextField`/UI-primitive change (kept scoped to this one form). No card value is ever logged, thrown into an error message, or otherwise surfaced outside the input itself.

**5–6. Initial note and partial-failure handling.** The note is saved through the *existing*, unmodified `caseLogService.create` — no new storage, no duplicate field on `Case`. `organizationId` comes from `useOrganization()` (trusted, session-resolved, same as every other write in this app) and `author` from `useSession()` (the same session-derived trust already used for `createdBy`/`intakeOwnerId` on the very same form) — neither is a form field, so neither can be client-supplied in the sense this phase's own scope forbids. Case creation and note creation are two independent writes/mutations; the modal tracks `createdCase` (set only once the case genuinely exists) separately from the note-save mutation's own error state, so:
- A note-save failure never re-invokes case creation (no duplicate case is possible — retry only re-runs the note mutation, addressed at the *same*, already-created `caseId`).
- The user sees an explicit banner ("Case created successfully. We couldn't save your note...") — never a generic/false "creation failed" message.
- The typed note text is never cleared on failure; "Retry saving note" reuses it, "Continue without note" abandons it and navigates to the (successfully created) case.
- A blank or whitespace-only note never calls `caseLogService.create` at all — no empty `CaseLogEntry` is ever created.
- Line breaks are preserved end-to-end: only leading/trailing whitespace is trimmed before saving, and `components/case/CaseLogCard.module.css`'s `.entryBody` gained `white-space: pre-line` (previously absent — a plain `<div>` silently collapses `\n` into a space) so a multi-line note actually *displays* as multiple lines, not just stores them invisibly.

## Known architectural gap (reported, not worked around)

**Case notes have no Wix write path, and this phase does not add one.** In both `DATA_ADAPTER=mock` and `DATA_ADAPTER=wix`, this form's note (like every other CaseLogCard note, on any case, before or after this phase) is written only to the client-side, in-memory `caseLogFixtures` array — it never reaches Wix, and does not survive a page reload or a server restart, regardless of adapter mode. This is unchanged, pre-existing behavior, not a regression: `caseLogService` was never migrated in Phases 15B-16 the way `cases`/`tasks` were. Building real Wix persistence for case notes (a new Wix Data collection, mapper, Route Handler, and adapter-mode wiring on the same scale as Phases 15B-16) is out of this "UX polish" phase's scope — it is a dedicated future phase, tracked in `docs/ROADMAP.md`.

## Consequences

- Every date/expiry field's validation is purely client-side presentation logic; it does not touch `NewCaseInput`, `CaseUpdate`, or anything sent to a Route Handler — the Wix write integration (Phase 16) is completely untouched.
- The Phase 15X authorization boundary is unaffected: no new Route Handler was added, and the two existing trusted-context sources (`useOrganization()`, `useSession()`) are used exactly as they already were elsewhere in this same form.
- A future "Wix-backed case notes" phase will need to decide the same `_id = beaconLogEntryId`-at-insert-time convention (docs/WIX_DATA_SCHEMA.md's already-established pattern for `cases`/`tasks`) and give `caseLogService.create` the same `dataAdapterMode` parameter `casesService`/`tasksService` already have — at which point this modal's partial-failure handling (already built around an independently-failable note mutation) needs no changes at all to start reflecting real network failures instead of a purely theoretical one.
