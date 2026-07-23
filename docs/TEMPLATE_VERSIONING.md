# Workflow Template Versioning

Phase 11 moved Beacon's case workflow — stages, checklist items, intake fields — out of hardcoded domain constants and React components into per-organization, versioned configuration. This document describes the model, how versioning works, how existing mock cases were migrated onto it, and what's deliberately still out of scope. See [ADR-006](./adr/ADR-006-workflow-template-architecture.md) for why this shape was chosen over the alternatives.

Types live in `types/workflowTemplate.ts` and `types/externalFormIntegration.ts`. Resolution logic lives in `domain/workflow/`. The fixture data lives in `services/__mocks__/workflowTemplates.ts`.

## The model

```
WorkflowTemplate (one per organization per workflow — an org can have several)
  id, organizationId, name, isEnabled, caseTypes: string[]
  versions: WorkflowTemplateVersion[]        — append-only, oldest first

WorkflowTemplateVersion
  version: number                            — 1, 2, 3, ... never reused
  caseTypes: string[]
  stages: StageTemplate[]
  intake: IntakeTemplate
  createdAt

StageTemplate
  rawStage, displayStage                     — see "Raw vs. display stage" below
  label, isAttentionStage, slaTargetDays
  checklist: ChecklistTemplate

ChecklistTemplate
  items: ChecklistItemTemplate[]

ChecklistItemTemplate
  index, label, hasField, isPasswordField?
  externalFormIntegrationId?                 — see "JotForm as an integration" below

IntakeTemplate
  sections: IntakeSectionTemplate[]

IntakeSectionTemplate
  key, label, fields: IntakeFieldTemplate[]

IntakeFieldTemplate
  key, label, placeholder?, password?
  checklistItemIndex?                        — which checklist item this field's value seeds
  mapsToCaseField?                           — which structured Case field this value also populates
  fieldType?, required?, defaultValue?, displayOrder?,
  uppercase?, masked?, multiline?, validationType?, options?
                                              — Phase 19 (see ADR-020) — all optional, defaulted by
                                                domain/workflow/resolveIntakeField.ts for any pre-Phase-19 record

CaseWorkflowSnapshot (embedded on every Case, not a separate collection)
  workflowTemplateId, workflowTemplateVersion
  stages, intake                             — a structuredClone taken at creation time
```

## Raw vs. display stage

Managed Cremations tracks "First Call" and "Payment" as two separate raw progress steps (a case's `rawStage` can be 0 or 1 distinctly) that both render as one stepper position — this predates Phase 11 (`domain/cases/stages.ts`'s original `toDisplayStage`/`toRawStage`) and is preserved exactly. In the template model, this is represented as two `StageTemplate` entries (`rawStage: 0` and `rawStage: 1`) that share `displayStage: 0`. `domain/workflow/resolveStages.ts`'s `findStageByDisplayStage` collapses duplicates when it needs one entry per stepper position (`displayStagesInOrder`); `findStageByRawStage` is used when a case's actual progress (`Case.rawStage`) needs to look up its current stage directly.

A different organization's template doesn't need this distinction at all — its `rawStage` and `displayStage` can simply be equal for every stage (see the second mock organization's template, three stages, no combining). The model doesn't assume combining happens; it just doesn't prevent it either.

**Constraint:** every template's raw stages must be sequential integers starting at 0 with no gaps. `domain/cases/transitions.ts`'s `advanceToNextStage` (the Dashboard's bulk "Advance to next stage" action) still does a plain `rawStage + 1` — this wasn't changed, since every template in this codebase already satisfies the constraint, and a future template author needs to know that requirement rather than have it silently enforced.

## Immutability

`Case.workflowSnapshot` is the actual mechanism behind "editing a template later doesn't change existing cases" — not a policy enforced by convention, but a structural fact: every stage/checklist-resolving function (`domain/workflow/resolveStages.ts`, `resolveChecklist.ts`, `domain/cases/viewModel.ts`) reads `case_.workflowSnapshot`, and *never* re-reads the live `WorkflowTemplate` fixture for an existing case. `domain/workflow/snapshot.ts`'s `buildCaseWorkflowSnapshot` uses `structuredClone`, a true deep copy — mutating a `WorkflowTemplateVersion`'s `stages` array after a case has been created cannot reach that case's own copy. `services/casesService.test.ts` proves this directly: it mutates the live Managed Cremations fixture after creating a case and asserts the case's snapshot is unaffected.

`CaseUpdate` (`types/case.ts`) excludes `workflowTemplateId`, `workflowTemplateVersion`, and `workflowSnapshot` entirely — none of the three can be touched by an update patch, by construction, the same way `intakeOwnerId` is excluded (see `domain/cases/intakeOwnership.ts`).

## JotForm as an integration, not a business concept

The "Jotform application completed" checklist item is data, not code: `ChecklistItemTemplate.externalFormIntegrationId` on that one item references an `ExternalFormIntegration` fixture record (`services/__mocks__/externalFormIntegrations.ts`) whose `provider` field happens to be `'jotform'`. `domain/workflow/resolveChecklist.ts`'s done/locked resolution has no branch on this field, on `provider`, or on the literal string "jotform" anywhere — an organization using a different form vendor, or no external form at all, needs only a different (or absent) `externalFormIntegrationId` value; no domain-layer or component change. `domain/cases/viewModel.test.ts` verifies both the wiring (the item's reference matches the fixture) and the non-special-casing (the item's toggle/lock behavior is identical to any other checklist item's).

## Migration notes for existing mock cases

Every case in `services/__mocks__/fixtures.ts`'s `caseFixtures` predates this field. Since Managed Cremations has only ever had one workflow, there's nothing ambiguous to migrate: each seed case is backfilled with `workflowTemplateId: managedCremationsWorkflowTemplateFixture.id`, `workflowTemplateVersion: 1`, `caseType: 'cremation'`, and its own `buildCaseWorkflowSnapshot(...)` call (a fresh `structuredClone` per case, not one object shared across all eight — nothing should ever need to mutate a snapshot, but there's no reason to risk a shared reference either).

A real backend migration would look the same in shape: for every existing case, determine which workflow it was actually run under (here, unambiguous — only one ever existed), snapshot that template's current definition, and write it onto the case record once. `Case.workflowSnapshot` is typed `CaseWorkflowSnapshot | null` specifically to allow a real migration to proceed incrementally (null = "not yet migrated") rather than requiring a single atomic cutover; in this codebase, the migration is already complete, so no case currently has a null snapshot in practice.

## Known scope limits

Deliberately not addressed in Phase 11 — each is safe today only because no UI exists to switch the active organization, and would need to be revisited before one is built:

- **Dashboard (`app/(portal)/dashboard/page.tsx`) and Reports (`domain/reports/calculations.ts`, `app/(portal)/reports/page.tsx`)** still import `STAGES`/`LAST_DISPLAY_STAGE` directly from `domain/cases/stages.ts` rather than resolving per-case from each case's own snapshot. Both pages only ever aggregate across a single organization's cases (via `useOrganization()`'s hardcoded value), so this is correct in practice today but would produce wrong groupings for an organization whose template doesn't match Managed Cremations' shape.
- **`domain/cases/stages.ts` and `domain/cases/checklist.ts`'s `buildChecklist`-adjacent helpers are gone from runtime use** but the raw data constants (`STAGES`, `CHECKLIST_BY_RAW_STAGE`, `isFirstCallStage`, etc.) remain, read only by the fixture builder and by Dashboard/Reports as above.
- **Veteran/VA workflow** (`domain/cases/veteran.ts`, `VA_STEPS`) is not templatized — it remains a fixed, hardcoded feature available to every case regardless of organization or template. Whether VA notification should itself become organization-configurable wasn't part of this phase's required behavior.
- **Required-document rules** (`domain/cases/viewModel.ts`'s `buildRequiredDocuments`) are still keyed directly off raw-stage thresholds, not the template.
- **New Case modal copy** (title, description paragraph) is static English text referencing "First Call & Payment" by name — only the field *structure* is template-driven, not the surrounding prose.
- **No case-type picker.** A `WorkflowTemplate` can list multiple `caseTypes`, but `NewCaseModal`/`useCreateCase` simply pick "the organization's first enabled template" rather than asking the user which case type they're creating. Sufficient today since Managed Cremations has exactly one template and one case type.
- **No admin editor, settings page, or drag-and-drop** — explicitly out of scope per the phase's own rules. Templates are only ever edited by hand in `services/__mocks__/workflowTemplates.ts`.

**Update (Phase 18, Workflow Management):** an admin editor now exists (`app/(portal)/settings/`, `POST /api/workflow-templates/[templateId]/versions`) — see [ADR-019](./adr/ADR-019-workflow-management.md). It covers editing an existing stage's label/SLA target/attention flag/checklist item labels and reordering existing stages; every edit creates a brand-new `WorkflowTemplateVersion` rather than modifying history, so everything above this note remains accurate. Still not built: adding/removing a stage or checklist item, editing `caseTypes`/`name`/`isEnabled`, and drag-and-drop (reordering uses explicit up/down controls instead).

**Update (Phase 19, Configurable Intake Form Builder):** `intake` is now fully editable too — see [ADR-020](./adr/ADR-020-configurable-intake-form-builder.md). The same editor gained add/edit/delete/reorder for intake fields (field type, required, placeholder, uppercase, masking, validation, select options), and `NewCaseModal.tsx`'s New Case form now renders and behaves entirely from each field's own configured properties instead of hardcoding behavior by literal field key. Still not built: adding/removing an intake *section*, editing intake as anything other than "fields within an existing section."
