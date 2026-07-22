# ADR-012: Wix Workflow Template Read Integration

**Status:** Accepted
**Date:** 2026-07-22

## Context

Following Phase 15A's organization read integration and the Auth/Data Adapter Separation refactor, workflow templates remained entirely mock-backed regardless of `DATA_ADAPTER`. Phase 15B needed the same real-Wix-read treatment for workflow templates and their versions, while preserving `services/workflowTemplatesService.ts`'s existing interface, `hooks/useWorkflowTemplates.ts`'s existing query key shape, and — critically — the domain model's nested `WorkflowTemplate.versions: WorkflowTemplateVersion[]` shape, which every existing consumer (`NewCaseModal.tsx`, `domain/workflow/snapshot.ts`) depends on.

The central complication: Phase 14A's Wix Data schema deliberately splits template identity from version identity into two separate collections (`workflowTemplates`, `workflowTemplateVersions`) — the opposite shape from the domain model's single nested object. Any Wix read has to re-join these two collections back into one nested `WorkflowTemplate` before returning it to a caller.

## Decision

Mirror Phase 15A's established pattern exactly: `services/workflowTemplatesService.ts` never branches on `DATA_ADAPTER` itself (it's called from a Client Component hook, and the real env var isn't visible in the browser bundle) — it always `fetch()`es new Route Handlers (`app/api/workflow-templates/route.ts`, `app/api/workflow-templates/[templateId]/route.ts`), which alone read `getDataAdapterMode()` and branch. `lib/wixWorkflowTemplateMapper.ts` is the one place raw Wix item shapes are ever touched, mirroring `lib/wixOrganizationMapper.ts`'s role — it validates and maps `workflowTemplates` items into a template summary, validates and maps `workflowTemplateVersions` items into `WorkflowTemplateVersion`s, and a third function, `buildWorkflowTemplate`, re-joins the two into the exact nested `WorkflowTemplate` shape every mock fixture already has.

Three identifier/semantics decisions, made explicit because nothing in the existing domain model directly answers them:

1. **A version has no id of its own.** `types/workflowTemplate.ts`'s `WorkflowTemplateVersion` never had an `id` field — it's identified structurally by `(templateId, version number)` in every mock fixture. No id is invented for it in the Wix mapping either.
2. **"Latest" is resolved positionally, not by a "published"/"current" flag** — because no such flag exists anywhere in the pre-existing domain model (`domain/workflow/snapshot.ts`'s `latestTemplateVersion` is `versions[versions.length - 1]`). `buildWorkflowTemplate` sorts assembled versions ascending by `version` number specifically so this positional convention keeps meaning "latest" regardless of the order Wix's query happens to return rows in.
3. **A template with zero valid versions is excluded from results entirely**, rather than returned with `versions: []`. This is an **application-integrity rule**, not a cosmetic filtering choice: a workflow template without a usable immutable version has nothing safe to snapshot onto a case, so it must not be selectable for creating one. The tradeoff is explicit — every consumer that resolves "latest" (`latestTemplateVersion`) throws on an empty array, so the alternative (returning a broken template with `versions: []`) wouldn't prevent a crash, it would only move it later and further from its cause, and would let a template with no real content appear selectable in the UI right up until that crash. Excluding it upstream means the app fails safely (the template simply doesn't appear) instead of allowing selection and crashing afterward. This is a considered choice, not silently invented — recorded here for visibility.

## Consequences

- `workflowTemplatesService.list()`/`getEnabledForCaseType()` are unchanged in signature and behavior; `get(context, templateId)` is new API surface (explicitly requested scope) with no current UI consumer.
- `hooks/useWorkflowTemplates.ts` is completely unchanged — its query key (`['workflowTemplates', organizationId]`) was already correctly organization-scoped before this phase.
- `components/modals/NewCaseModal.tsx` required zero changes — it already degrades safely when `templates`/`intake` are undefined, satisfying "show a safe empty state" without any new code.
- No dedicated "workflow template" UI page exists anywhere in the app (confirmed by inspection) — Phase 15B's manual verification is performed through `NewCaseModal`, the only real consumer, not a page that doesn't exist. Building one is explicitly out of this phase's scope.
- A list of N templates costs 1 + N Wix queries (one for templates, one per template for its versions, run in parallel via `Promise.all`). Acceptable at today's scale (one template exists); worth revisiting (e.g. a single query with an `$in` filter across resolved template ids) if template counts grow materially.
- Writes are entirely unaffected — `DATA_ADAPTER=wix` only changes template/version reads; case creation, template enable/disable, etc. all remain mock-only until Phase 16.

## Alternatives Considered

- **Flatten the domain model to match Wix's two-collection split** (give `WorkflowTemplateVersion` its own id, stop nesting `versions` inside `WorkflowTemplate`): rejected — out of scope ("preserve the existing domain-driven architecture") and would force changes to `NewCaseModal.tsx`, `domain/workflow/snapshot.ts`, and every mock fixture for no behavioral benefit.
- **Add a `publishedVersion`/`currentVersion` field to resolve "the relevant version"**: rejected — no such concept exists in the pre-existing domain model, and inventing one wasn't requested; "do not invent new precedence rules" applies directly here.
- **Single combined Wix query joining both collections server-side (e.g. an aggregation pipeline)**: rejected for this phase — two sequential/parallel queries or is simpler, easier to test in isolation, and matches the existing `queryWixDataItems` helper's shape exactly; revisit if the N+1 query pattern becomes a real performance concern.
