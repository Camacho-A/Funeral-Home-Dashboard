# ADR-014: Wix Task Read Integration

**Status:** Accepted
**Date:** 2026-07-22

## Context

Following Phase 15C's case read integration, tasks remained entirely mock-backed regardless of `DATA_ADAPTER`. Phase 15D needed the same treatment for `services/tasksService.ts`'s `list()` — while leaving `create()`, `update()`, and `remove()` (and every mutation hook built on them: `useCaseTasks`, `useTaskMutations`) completely untouched, per this phase's explicit scope.

**The read/write state-sharing conflict Phase 15C already solved applies identically here**: `list()`, `create()`, `update()`, and `remove()` all run client-side against one shared `services/__mocks__/fixtures.ts` array (`taskFixtures`). Making `list()` always fetch a server-side Route Handler would have moved its reads to a separate server-side module instance the client-side writes never touch — breaking "complete a task, see it update immediately" in pure mock mode. Resolved identically to ADR-013: the server-resolved `DATA_ADAPTER` value flows through `useOrganization()`'s existing context (established in Phase 15C, unmodified here) into `tasksService.list()` as an explicit parameter.

**A second, distinct finding, surfaced before any code was written**: several scope items in this phase's brief — due/overdue task lists, due-today sections, completed-date, priority, a status enum beyond a boolean, ordering/sequence fields, dashboard task widgets, assigned-to-me filtered views — **do not exist anywhere in the current architecture**. `types/task.ts`'s `CaseTask` has no field for any of them; `isDone: boolean` is the entire status model; no dashboard widget reads tasks at all (the Dashboard's "Needs attention" panel is case-based). Confirmed by direct search: every "overdue"/"priority"/"due date" reference in the codebase belongs to Cases (SLA/stage overdue), not Tasks.

## Decision

Mirror ADR-013 exactly for the read side: `tasksService.list()` gains a `dataAdapterMode` parameter (default `'mock'`); when `'mock'`, it runs the unchanged pre-existing fixture-filtering code; when `'wix'`, it fetches a new Route Handler (`app/api/tasks/route.ts`), which queries the `tasks` collection filtered by `organizationId` (and `caseId` when provided) and maps results via `lib/wixTaskMapper.ts`.

**No `get(taskId)` Route Handler or service function was added.** `tasksService` never had one, and nothing consumes one — "list tasks for a case" is already just `list({ caseId })`, exactly matching how `useCaseTasks(caseId)` already reuses `useTasks({ caseId })` today. Building a get-by-id endpoint here would be scope invention, directly against "only implement methods that already exist or are required by current consumers."

**No due date, priority, status enum, ordering field, or dashboard widget was added or invented**, per the same instruction — this phase implements exactly the read surface that exists today (`list`, optionally filtered by `caseId`), nothing more.

`create()`, `update()`, and `remove()` are entirely unmodified — same signatures, same client-side `taskFixtures` mutation, same callers.

## Consequences

- Mock mode (`DATA_ADAPTER=mock`) is provably unchanged: `list()`'s mock branch is byte-for-byte the pre-Phase-15D implementation, still sharing state with the three untouched write functions.
- **Known, accepted, documented limitation** (identical in shape to ADR-013's): while `DATA_ADAPTER=wix`, a task created, completed, or removed via the Tasks page or Case Detail's task card still only mutates the client-side mock `taskFixtures` (since none of those three functions changed) and will never appear changed in a subsequent Wix-sourced `list()` call — it was never written to Wix. This is inherent to "reads from Wix, writes deferred to Phase 16," true regardless of implementation choice, not a defect.
- Identifier handling: `beaconTaskId` → `CaseTask.id`; `assigneeId` → `CaseTask.assigneeStaffId` (renamed, carrying the same unresolved identity-space fork as Phase 15C's `caseHandlerId`); `caseId` and `text`/`isDone`/`createdAt` map unchanged. `caseId` is validated only as "string or null" — this phase does **not** verify a task's `caseId` actually refers to an existing case in the same organization (see "Relationship integrity" below).
- **Relationship integrity is a known, documented gap, not resolved here**: a task whose `caseId` points at a missing case, a deleted case, or (in principle) another organization's case is still mapped and returned as-is — `caseId` is opaque data to this mapper, matching this phase's "do not redesign identity mapping" instruction. UI consumers already degrade safely today when a linked case can't be found (`app/(portal)/tasks/page.tsx`'s `cases.find(...)` returns `undefined`, rendered as no case name) — this phase relies on that existing safe-degradation behavior rather than adding new validation.
- Query keys (`['tasks', organizationId, filters]`) are unchanged — `dataAdapterMode` is a single deployment-wide setting, not tenant-specific, matching ADR-013's reasoning exactly.
- The Route Handler's mock-mode branch is, in practice, dead code from the running app's perspective (the client never reaches it while `dataAdapterMode === 'mock'`) — kept for defense-in-depth and independent testability, matching every other Phase 15 Route Handler.

## Alternatives Considered

- **Build due dates/priority/status/dashboard widgets to satisfy the phase brief's listed scope items**: rejected — none exist in the current architecture; inventing them would be exactly the "silently redefine/expand scope" this phase's own instructions forbid.
- **Add a `get(taskId)` endpoint for symmetry with organizations/workflow templates/cases**: rejected — no current consumer needs one; case-scoped task reads are already served by `list({ caseId })`.
- **Validate `caseId` against the live case list at mapping time**: rejected for this phase — would require the task mapper to depend on case data (a cross-collection validation this phase's scope doesn't call for), and existing UI already degrades safely without it.
