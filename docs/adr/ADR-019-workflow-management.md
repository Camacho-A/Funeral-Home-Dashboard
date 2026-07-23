# ADR-019: Workflow Management (Admin Template Editing)

**Status:** Accepted
**Date:** 2026-07-23

## Context

Phase 11 (`docs/TEMPLATE_VERSIONING.md`) moved Beacon's stages/checklist/intake structure out of hardcoded constants into per-organization `WorkflowTemplate`/`WorkflowTemplateVersion` records, but explicitly deferred building any editor: "Templates are only ever edited by hand in `services/__mocks__/workflowTemplates.ts`." This phase begins closing that gap — a real, authenticated admin surface to view and edit a template's stages, without touching the read architecture, authorization, or the immutability guarantee existing cases depend on.

## Architecture reviewed

- **`WorkflowTemplate`** (`types/workflowTemplate.ts`): `id, organizationId, name, isEnabled, caseTypes: string[], versions: WorkflowTemplateVersion[]` (append-only, oldest first).
- **`WorkflowTemplateVersion`**: `version` (1, 2, 3, ... never reused), `caseTypes`, `stages: StageTemplate[]`, `intake: IntakeTemplate`, `createdAt`.
- **`StageTemplate`**: `rawStage`, `displayStage` (two raw stages can share one display position — Managed Cremations' First Call + Payment), `label`, `isAttentionStage?`, `slaTargetDays`, `checklist: ChecklistTemplate`. Constraint (pre-existing, documented in `docs/TEMPLATE_VERSIONING.md`): raw stages must be sequential integers starting at 0, no gaps.
- **`ChecklistTemplate`/`ChecklistItemTemplate`**: `items: { index, label, hasField, isPasswordField?, externalFormIntegrationId? }[]` — `index` must also be sequential from 0 within a stage.
- **Current Wix collections** (`docs/WIX_DATA_SCHEMA.md`): Collection 3 `workflowTemplates` (template identity, mutable `name`/`isEnabled`/`caseTypes`, backend/Admin-only permissions) and Collection 4 `workflowTemplateVersions` (version identity, **documented as append-only with no native Wix enforcement** — "must be enforced at the application service layer," a gap this phase's write path now actually closes rather than leaving purely aspirational).
- **Current mapper architecture** (`lib/wixWorkflowTemplateMapper.ts`): `mapWixWorkflowTemplateItem`/`mapWixWorkflowTemplateVersionItem` (read-side validation), `buildWorkflowTemplate` (re-joins the two collections into the nested shape every consumer expects), `fetchWixWorkflowTemplates` (list, Phase 15B/16). Read-only until this phase — no insert/update path existed for either collection.
- **Route Handlers**: `GET /api/workflow-templates` (list), `GET /api/workflow-templates/[templateId]` (one, with its full nested versions — already exactly the "view versions/stages/checklist" data this phase's viewing requirement needs, unchanged). Both already call `requireAuthorizedOrganization` (Phase 15X).
- **Client-side**: `services/workflowTemplatesService.ts` never branches on `DATA_ADAPTER` itself — every call is a `fetch()` to a Route Handler, which alone decides mock vs. Wix server-side (the same reasoning `organizationsService.ts` follows, since `DATA_ADAPTER` isn't visible in the browser bundle).

## Decision

### Viewing (no new endpoints needed)

`GET /api/workflow-templates/[templateId]` already returns the full nested `WorkflowTemplate` (every version, every stage, every checklist item) — "View workflow templates/versions/stages/checklist items" is satisfied by a new UI consuming data that already existed. A new `hooks/useWorkflowTemplate.ts` (singular, mirrors `useCase.ts`) wraps it.

### Editing — always a new version, never a patch to history

`POST /api/workflow-templates/[templateId]/versions` (new) accepts `{ organizationId, stages: StageTemplate[] }` — the admin's fully edited stages array (`caseTypes`/`intake` are always carried over unchanged from the latest version; neither is in this phase's edit scope). The handler:

1. `requireAuthorizedOrganization` (unchanged, reused).
2. `lib/wixWorkflowTemplateMapper.ts`'s new `validateWorkflowStagesPayload` — DTO/shape validation of the untrusted JSON body (right keys, right primitive types, deep through checklist items). Mirrors `wixCaseMapper.ts`'s `validateAndPickCaseUpdate` in spirit.
3. `domain/workflow/editing.ts`'s new `validateStageSequencing` — the *business*-rule validation layer (sequential `rawStage`/`index` from 0, non-empty labels, non-negative SLA) — kept separate from shape validation the same way `casesService`'s mock/Wix split keeps mechanism separate from format.
4. Loads the template's current latest version (mock: the shared fixture array; Wix: the newly-extracted `fetchWixWorkflowTemplateById`, reused by both this route and the existing single-template GET route rather than duplicated — matching the Phase 16 precedent of moving shared join logic into the mapper), computes `nextVersion = latest.version + 1`, and only ever **inserts** a new `workflowTemplateVersions` row (mock: `Array.push`; Wix: `insertWixDataItem`, never `updateWixDataItem`) — versions 1..N-1 are never touched by any code path this phase adds.
5. The Wix insert sets the item's own `_id` to `` `${templateId}-v${nextVersion}` `` — the same "system id doubles as the natural key" convention Phase 16/16B established for cases/tasks/`caseSequences`. A same-version collision (two admins saving at once) 409s and is surfaced to the client as a clear "reload and retry" error, rather than silently producing two rows both claiming to be the same version number.

### Versioning guarantees (structural, largely free)

- **Historical versions are never modified**: enforced by the write path only ever calling insert, never update, against `workflowTemplateVersions` — matching that collection's own documented append-only contract.
- **Current cases keep referencing their original version**: already true before this phase and unchanged by it — `Case.workflowSnapshot` (`domain/workflow/snapshot.ts`'s `buildCaseWorkflowSnapshot`) is a `structuredClone` taken at case-creation time; no domain function that resolves an existing case's stages/checklist (`domain/workflow/resolveStages.ts`, `resolveChecklist.ts`) ever re-reads the live `WorkflowTemplate`. Adding new versions is exactly the kind of "live template edit" this snapshot already exists to insulate cases from.

### Reordering (`domain/workflow/editing.ts`)

`moveStage(stages, index, direction)` swaps two adjacent stages and renumbers every stage's `rawStage`/`displayStage` sequentially from 0 — maintaining the pre-existing "no gaps" constraint automatically rather than trusting the caller to. **Known limitation**: this assigns each stage its own display position, so a pre-existing combined display stage (two raw stages sharing one `displayStage`) is not reproduced through a reorder — building UI for "which stages should visually merge" is out of this phase's scope. An org that never uses reordering never loses this; it's a consequence only of actively invoking "move."

### UI (`app/(portal)/settings/`, `components/settings/`)

Activates the Sidebar's previously-inert "Settings" entry (`components/layout/Sidebar.tsx`; `SidebarNavItemInert` removed as now-dead code). `WorkflowTemplateList` (picker) + `WorkflowEditor` (version history + editable stage list, local `structuredClone`d draft state, `Save as new version` / `Discard changes`). Nothing here reads or renders any Managed-Cremations-specific string — the second mock organization's differently-shaped template (3 stages, no combined display stages, different attention stage, different terminology) is used directly in tests to prove this.

### Scope explicitly deferred (not built this phase)

- Adding or removing a stage or a checklist item (only *existing* structure is editable).
- Editing `intake` fields, the template's own `name`/`isEnabled`/`caseTypes`, or `externalFormIntegrationId`/`hasField`/`isPasswordField` on a checklist item.
- Reordering that preserves/edits combined display stages.
- Full optimistic-concurrency retry (Phase 16B's insert-or-increment machinery) for version-number races — a same-version collision here 409s once rather than auto-retrying; a rare admin-editing collision is lower-stakes than a duplicate legal case number.

## Consequences

- Zero changes to `DATA_ADAPTER`/`AUTH_ADAPTER` separation, `requireAuthorizedOrganization`, or any existing read behavior — `GET /api/workflow-templates/[templateId]`'s wix-mode branch was refactored (its inline join logic extracted into `fetchWixWorkflowTemplateById`) but not behaviorally changed; its existing test suite passes unmodified.
- `workflowTemplateVersions`'s documented-but-previously-unenforced "insert-only" contract is now actually enforced by the one code path capable of writing to it.
- The admin editor is generic by construction: it renders whatever `stages`/`checklist` shape a template actually has, with no organization- or terminology-specific branching.

## Alternatives considered

- **Patch/merge semantics for editing** (client sends only changed fields, server merges onto the latest version): rejected — versions are a cohesive, all-or-nothing structure everywhere else in this codebase (`buildCaseWorkflowSnapshot` clones the whole thing, `WorkflowTemplateVersion` has no field-level history); a merge model would need to invent partial-application semantics for nested arrays (stages, checklist items) with no existing precedent to draw from.
- **Full atomic increment/insert-retry loop for version numbers** (mirroring `lib/wixCaseNumberSequence.ts`): rejected for this phase — workflow edits are a low-frequency, single-admin-at-a-time operation in practice, not a customer-facing uniqueness guarantee; the `_id`-collision 409 is a proportionate, cheap safety net, with the fuller mechanism available to build later if concurrent-editor collisions turn out to matter in practice.
