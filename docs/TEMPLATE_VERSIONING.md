# Workflow Template Versioning

Phase 11 moved Solis's case workflow — stages, checklist items, intake fields — out of hardcoded domain constants and React components into per-organization, versioned configuration. This document describes the model, how versioning works, how existing mock cases were migrated onto it, and what's deliberately still out of scope. See [ADR-006](./adr/ADR-006-workflow-template-architecture.md) for why this shape was chosen over the alternatives.

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
  status?, approvedBy?, approvedAt?, ...    — service-specific workflows (see docs/GUS_WORKFLOWS.md)
  completionPolicy?                          — 2026-10, see "Completion policy" below; absent = today's rule
  derivedFrom?: { templateId, version }      — 2026-10, the template this version was copied from

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
  serviceTypeCode?                           — service-specific workflows
  completionPolicy?                          — copied only when the version has one
```

## Completion policy (2026-10)

`WorkflowTemplateVersion.completionPolicy` says when a case created from that
version is finished:

```
WorkflowCompletionPolicy
  kind: 'remains_return' | 'final_items'
  requiresRemainsReturn: boolean             — must agree with kind
  requiredFinalItems: { displayStage, index, label }[]
                                              — items of the final stage or the one before it;
                                                the label detects an item later moved/renamed
  manualCompletion: { allowed, permission?: 'case.update' | 'case.delete' }
  archiveEligibility: 'on_completion' | 'manual'
  note?                                      — administrator-facing, never read by case logic
```

- **Absent means today's rule.** No policy = `LEGACY_COMPLETION_POLICY`
  (`domain/workflow/completionPolicy.ts`): the case is complete on its final
  stage once the return of cremated remains is recorded, nothing else. Every
  Manors and evergreen version and every snapshot taken before policies existed
  has no policy, so none of them changes.
- **Frozen with the stages.** `buildCaseWorkflowSnapshot` copies the policy (a
  deep copy, with the stages it refers to), only when the version has one — a
  snapshot built from a version without one is byte-identical to before. A
  later edit never changes how an existing case completes.
- **Evaluated in one place.** `domain/cases/completionEligibility.ts`'s
  `evaluateCaseCompletion` is the only answer to "is this case complete?":
  `isCaseWorkflowComplete`/`becameComplete` (archiving, the completion
  announcement), the view model's "Completed" stage and row status, and,
  through the view model's `displayStage`, the reports. The one-stage
  hold-back on the final stage (`resolveEffectiveDisplayStage`) now holds a
  case back until its policy is met. `completionTransition` adds whether the
  transition archives (policy-driven).
- **Validation.** Draft level: a known kind that agrees with
  `requiresRemainsReturn`, well-formed item references, a known permission and
  archive setting. Approval level: a `final_items` policy needs at least one
  required item; every required item must still resolve to the item it was
  chosen with; no duplicates. For an organization whose versions require
  approval, a version without a policy cannot be approved.
- **Saving.** `POST .../versions` accepts `completionPolicy` only for an
  organization whose versions require approval (400 otherwise, so other rows
  keep their exact shape). Omitted, the latest version's policy carries over.
  `derivedFrom` is never taken from the request; it carries over from the
  latest version.
- **Wix.** `workflowTemplateVersions` gains two optional object columns,
  `completionPolicy` and `derivedFrom`, written only when present and read
  leniently (a malformed value reads as absent, never drops the row).

## Approval protections (2026-10)

For organizations whose versions require approval, the approve route also
requires the approver's review attestation (`stagesReviewed`,
`checklistReviewed`, `completionReviewed`, all `true`; 422 otherwise) and
refuses (422) a placeholder stage ("… — steps to be defined"), a missing or
incomplete completion policy, and a version that is still an unmodified copy
— identical stages, items and completion requirements to any version of its
`derivedFrom` template, or (for a version with no marker) to an approved
version of another of the organization's templates. Refused attempts are
recorded as `workflow.template.approval_refused`; approvals as
`workflow.template.published` with the attestation and policy in its metadata.
See docs/GUS_WORKFLOWS.md.

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

**Update (2026-10, workflow template editor):** stages and checklist items can now be added, removed, renamed and reordered, item requirements (`hasField`, `valueKind`, `isPasswordField`, `requiredCaseFields`) are editable, a template can be assigned to its service type, and a draft can be previewed and approved — see `docs/GUS_WORKFLOWS.md` for the administrator's view. Two rules make that safe:

*Numbering* (`domain/workflow/templateEditing.ts` — every editor operation renumbers through it, so the editor can only submit a coherent version):

- `rawStage` is the stage's array position, 0, 1, 2 … with no gaps.
- `displayStage` is the display stage's position, 0, 1, 2 … with no gaps. A display stage is one or more *consecutive* raw stages sharing a `displayStage`. Raw stages that shared one keep sharing it through every edit, so the existing cremation shape (First Call raw 0 + Payment raw 1 → display 0) is preserved whether or not it was edited. The editor edits, moves and removes a display stage as one unit, and every raw stage in it carries the same label, SLA, attention flag and item list. A stage *added* in the editor is always one raw stage = one display stage.
- Item `index` is the item's position in its checklist, 0 … n-1. Within a combined display stage the item lists are identical; only the first raw stage's items may be data-entry (`hasField: true`), exactly like the existing Payment raw stage.
- There is no stable item id: an item's identity is (displayStage, index), which is what `checklistState` keys use. That is safe because only cases created *after* a version is live use it; existing cases keep their frozen `workflowSnapshot`.
- Intake fields fill the first display stage's checklist by index (`checklistItemIndex`, bare-index `fieldValues`). Reordering or removing items there re-points those fields to the same items; an item a field fills cannot be removed, and the first stage cannot be moved or removed while fields fill it.

*Validation* (`domain/workflow/templateValidation.ts`, pure, used by the editor and enforced by the server):

- **Draft level** (POST `.../versions`, 400 with `details` + `problems`): ≥1 stage; sequential `rawStage`; `displayStage` starts at 0 and steps by 0 or 1; a combined display stage's raw stages share label and checklist; sequential item `index`; non-empty stage and item labels; SLA empty or a finite number ≥ 0; a proposed service assignment names active `service_type` codes, each once. Applied to every organization (Manors' and Gus' existing versions all pass).
- **Approval level** (POST `.../versions/[version]/approve`, 422 with the full list; an already-approved version is 409): everything above, plus ≥2 display stages; the final display stage is the terminal stage, i.e. its label is exactly "Completed" (trimmed, case-insensitive); unique display-stage labels; ≥1 checklist item on every stage before Completed; unique item labels within a stage; data-entry items only in the first stage; `requiredCaseFields` only supported structured case fields and never with `hasField`; SLA a whole number of days or a same-day fraction below 1 (the existing 0.25 First Call target); for service-specific organizations, at least one service and none already served by another *enabled* template. Only organizations with an approval step run this level.

`ChecklistItemTemplate.valueKind` (the Time of Death 12-hour picker) used to be dropped by `lib/wixWorkflowTemplateMapper.ts`'s `validateWorkflowStagesPayload` on every save; it — and every other item/stage field — now round-trips exactly (present when present, absent when absent).
