# ADR-006: Workflow Template Architecture

**Status:** Accepted
**Date:** 2026-07-21

## Context

Through Phase 10, every organization-specific piece of Beacon's case workflow — the seven display stages, the checklist item text and locking behavior per stage, the New Case intake form's fields, the "Jotform application completed" checklist step — was hardcoded directly into `domain/cases/stages.ts`, `domain/cases/checklist.ts`, and `components/modals/NewCaseModal.tsx`, all written for exactly one organization (Managed Cremations) and one workflow (standard cremation intake). Beacon now needs to support additional funeral homes with their own stages, checklist items, and intake fields, without rewriting or forking the shared Case Detail, Dashboard, or New Case components for each one, and without touching Managed Cremations' existing, already-approved workflow.

Two constraints shaped the decision more than any other:

1. **Historical cases must never change retroactively.** If an organization edits its workflow template (renames a stage, adds a checklist item), every case created before that edit must keep rendering exactly as it did when it was created — a case's stages/checklist are a historical fact, not a live view onto today's configuration.
2. **JotForm is one vendor's integration, not a business concept.** The checklist item text just happens to say "Jotform" today because that's the one external form Managed Cremations currently uses; a different organization might use a different form vendor, or none at all, and the domain layer should never need to know the difference.

## Decision

Introduce a versioned workflow template model (`types/workflowTemplate.ts`): `WorkflowTemplate` (per organization, one or more) → `WorkflowTemplateVersion` (append-only, never mutated in place) → `StageTemplate` (raw/display stage, label, SLA target, attention flag, its own `ChecklistTemplate`) → `ChecklistItemTemplate` (label, field-vs-checkbox, optional `externalFormIntegrationId`). Intake structure gets a parallel `IntakeTemplate` → `IntakeSectionTemplate` → `IntakeFieldTemplate` model, each field optionally mapping onto a structured `Case` field and/or a checklist item index.

Every `Case` stores `workflowTemplateId`, `workflowTemplateVersion`, and — critically — an immutable `CaseWorkflowSnapshot`: a `structuredClone` of the resolved stages/checklist/intake taken at creation time (`domain/workflow/snapshot.ts`). Every stage/checklist-resolving domain function (`domain/workflow/resolveStages.ts`, `resolveChecklist.ts`, and `domain/cases/viewModel.ts`) reads this snapshot, never the live `WorkflowTemplate` fixture — this is what makes the immutability guarantee real rather than assumed: a template edit literally cannot reach an existing case, because the case never looks at the template again after creation.

JotForm is modeled as `types/externalFormIntegration.ts`'s `ExternalFormIntegration` — a plain `{ provider: string, label, externalFormId }` record. A `ChecklistItemTemplate` can reference one via `externalFormIntegrationId`; `domain/workflow/resolveChecklist.ts`'s done/locked resolution never branches on it or on any provider name — it's display metadata a future UI treatment could use, not a business rule.

Managed Cremations' template (`services/__mocks__/workflowTemplates.ts`) is built *from* the pre-existing `domain/cases/stages.ts`/`checklist.ts` constants (`STAGES`, `CHECKLIST_BY_RAW_STAGE`, `isBottleneckStage`, `getSlaTargetDays`) rather than hand-retyped, so the fixture cannot silently drift from what those constants already described — the actual mechanism behind "Managed Cremations must behave exactly as before," not just an intention. Those constants themselves, along with the Dashboard and Reports pages that import them directly, are deliberately left unchanged — see `docs/TEMPLATE_VERSIONING.md`'s "Known scope limits."

## Consequences

- A second organization's case resolves its own stages/checklist/intake through the *same* shared functions and components (`ChecklistCard`, `StageStepper`, `CaseInformationCard`, `NewCaseModal`) that render Managed Cremations' cases — proven in `domain/cases/viewModel.test.ts` by constructing a case against a deliberately differently-shaped second template and asserting correct resolution, with no component change required.
- Editing a template fixture's stages/checklist after a case exists cannot retroactively change that case — proven directly in `services/casesService.test.ts` by mutating the live fixture after creation and asserting the existing case's snapshot is unaffected.
- `NewCaseModal` no longer hardcodes its field list; it renders whichever `IntakeTemplate` the organization's enabled `WorkflowTemplate` resolves to. Its title and description copy remain static English text — copy templatization wasn't part of this phase's required behavior and would be a materially larger change (see `docs/TEMPLATE_VERSIONING.md`).
- Adds real complexity: a case's stage/checklist rendering now depends on reading its own snapshot correctly rather than a straightforward constant import, and a new `domain/workflow/` module sits alongside the existing `domain/cases/` one. Justified because the alternative — forking components per organization, or branching on `organizationId` inside shared components — is exactly what "never store organization-specific rules directly in generic React components" rules out.
- Dashboard and Reports pages, and `domain/cases/stages.ts`/`checklist.ts` themselves, are **not** snapshot-aware — they still assume Managed Cremations' stage list directly. This is safe today only because no UI exists to switch the active organization (`hooks/useOrganization.tsx` is hardcoded to one organization); it becomes a real gap the moment organization-switching is built, and is recorded as such rather than silently left implicit.

## Alternatives Considered

- **Branch on `organizationId` inside shared domain functions/components** (e.g. `if (organizationId === 'managed-cremations') { ... } else { ... }`): rejected outright — this is precisely the "organization-specific rules in generic code" pattern the phase's requirements explicitly forbid, and it doesn't scale past two organizations.
- **Store only `workflowTemplateId`/`workflowTemplateVersion` on a case, re-resolving stages/checklist from the live template on every read**: rejected — this cannot satisfy the immutability requirement; a template edit would retroactively change every case still referencing that version, which is the exact failure mode the phase was scoped to prevent.
- **Make Dashboard/Reports/`domain/cases/stages.ts` fully snapshot-aware in this same pass**: rejected as unnecessary scope expansion — those surfaces are unreachable for any organization other than Managed Cremations today (no org-switching UI exists), and "don't rewrite components unnecessarily" was an explicit constraint. Deferred and documented instead of speculatively generalized.
