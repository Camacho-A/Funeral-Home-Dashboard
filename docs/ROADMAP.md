# Roadmap

## Version 1 — Case Operations (current)

Scope: the four screens visualized in `design/Beacon.dc.html` — Dashboard, Case Detail, Tasks, Reports — backed by Wix Managed Headless for operational data and a small Postgres/object-storage service for compliance documents and the audit trail. Single tenant (Managed Cremations), architected for multi-tenancy from day one. See [PRODUCT_VISION.md](./PRODUCT_VISION.md) for full scope and [ARCHITECTURE.md](./ARCHITECTURE.md) for the technical shape.

Notably, the Reports screen's org switcher in the current design already lists a second, disabled entry — "Gus Camacho Funeral Home — coming soon" — meaning the visual design itself was built anticipating that Beacon would serve more than one funeral home. That expectation is honored structurally (via `organizationId` on every record) well before it's honored functionally.

## Completed: Multi-Tenant Authorization Hardening (Phase 15X)

**Status: closed 2026-07-23.** Originally recorded during Phase 15B's final review — see [ADR-012](./adr/ADR-012-wix-workflow-template-read-integration.md)'s review findings and the former "Known limitations" entry this superseded in `docs/AUTHENTICATION.md`. Full writeup: [ADR-015](./adr/ADR-015-multi-tenant-authorization-hardening.md).

**The gap (now closed):** none of the Route Handlers introduced by the Wix read integrations verified that the `organizationId` in the request actually belonged to the caller's authenticated session — `organizations`, `workflow-templates` (both routes), `cases` (both routes), and `tasks` all trusted a path/query parameter directly. As public HTTP endpoints with no middleware coverage (`middleware.ts`'s matcher deliberately excludes `/api/*`), any HTTP client — authenticated or not — could call any of these six routes with a forged `organizationId` and receive that organization's data.

**Resolution:** a single reusable helper, `lib/auth/requireAuthorizedOrganization.ts`'s `requireAuthorizedOrganization(requestedOrganizationId)`, composes the already-existing, already-tested `resolveAuthorizationContext` (Phase 13) with session resolution and a standardized `401`/`403` `NextResponse`. All six Route Handlers now call it before using `organizationId` for anything, and use only the returned, trusted `context.organizationId` downstream. See ADR-015 for the full design, the architecture-review findings that preceded implementation, and what remains explicitly deferred (real Wix-backed membership data, still mock-fixture-only; Phase 16 write endpoints must reuse this same helper rather than re-deriving authorization inline).

## Completed: Wix Write Integration (Phase 16)

**Status: closed 2026-07-23.** Full writeup: [ADR-016](./adr/ADR-016-wix-write-integration.md).

**The gap (now closed):** `casesService.create/update` and `tasksService.create/update/remove` were mock-only — a case or task created/edited while `DATA_ADAPTER=wix` never persisted to Wix, so it never appeared in a subsequent Wix-sourced read (documented in ADR-013/014). Real Wix writes now exist for case create/update and task create/update/delete, all reusing Phase 15X's `requireAuthorizedOrganization` — no new authorization logic was written. `lib/wixDataApi.ts` gained `insertWixDataItem`/`updateWixDataItem`/`deleteWixDataItem`; `lib/wixCaseMapper.ts`/`lib/wixTaskMapper.ts` gained matching write-side build/validate/merge functions; four Route Handlers were added or extended (`POST /api/cases`, `PATCH /api/cases/[caseId]`, `POST /api/tasks`, and a new `app/api/tasks/[taskId]/route.ts` for `PATCH`/`DELETE`).

**Remaining, explicitly deferred (unchanged by this phase):** `createdBy`/`intakeOwnerId` still derive from `hooks/useSession.ts`'s hardcoded stub, not a real server-resolved identity — Identity Model Hardening remains open. Real Wix-backed `organizationMemberships` reads (Phase 15X's own deferred item) are also still outstanding — both are prerequisites for a genuine second organization to operate through this app, not just exist in fixtures.

## Completed: New Case UX Polish and Initial Note (Phase 16A)

**Status: closed 2026-07-24.** Full writeup: [ADR-017](./adr/ADR-017-new-case-ux-polish-and-initial-note.md).

Uppercase transform, MM/DD/YYYY and MM/YY input masks with real calendar/month validation, and a show/hide toggle for card fields (replacing permanent unmasking) were added to the New Case form (`utils/inputMask.ts`, `components/modals/NewCaseModal.tsx`). An optional initial note is now saved through the existing `caseLogService`, with independent partial-failure handling (a note-save failure never re-creates the case, never loses the typed text, and is clearly distinguished from a case-creation failure).

**Gap found, not resolved here (out of this phase's "UX polish" scope):** case notes (`services/caseLogService.ts`) have no Wix write path at all — no collection, no Route Handler, no `dataAdapterMode` — in any phase to date. A note saved through this form (or any existing Case Log note) lives only in client-side mock memory regardless of `DATA_ADAPTER`, unlike cases/tasks (Phase 16). Building real Wix-backed case notes is future work, sized similarly to Phases 15B/15D (schema + mapper + Route Handler + adapter wiring).

## Completed: Case Number Generation (Phase 16B)

**Status: closed 2026-07-23.** Full writeup: [ADR-018](./adr/ADR-018-case-number-generation.md).

Every case now has a permanent, human-facing `B{YYYY}-{###}` identifier (e.g. `B2026-001`), always server-generated and read-only, displayed prominently on Case Detail and in every case list/table, and searchable from the global search bar. Mock-mode generation is a simple scan of existing fixtures (safe — single-threaded); Wix-mode generation uses a new `caseSequences` collection and an atomic `INCREMENT_FIELD` patch, empirically verified against the live Wix project to be race-free under concurrent case creation, with a race-safe bootstrap path for a year's first case. Case Numbers are never reused — Beacon's existing soft-delete-only model (cases are never hard-deleted) already guarantees this structurally, with no new code needed for that guarantee.

**Deferred, unchanged by this phase:** case notes still have no Wix write path (Phase 16A's own reported gap); identity model hardening remains open (Phase 16's own reported gap).

## Completed: Workflow Management (Phase 18)

**Status: closed 2026-07-23.** Full writeup: [ADR-019](./adr/ADR-019-workflow-management.md).

The first real admin surface for workflow templates: a new `/settings` page (activating the Sidebar's previously-inert "Settings" entry) lists an organization's templates and lets an admin view every version's stages/checklist items and edit an existing stage's label, SLA target, attention flag, and checklist item labels, plus reorder stages. Every edit is saved via a new `POST /api/workflow-templates/[templateId]/versions`, which always **inserts** a brand-new `WorkflowTemplateVersion` — historical versions are never modified, and existing cases keep resolving against their own `Case.workflowSnapshot` exactly as before (both guarantees were already structurally true; this phase's write path simply never violates them). `workflowTemplateVersions`' previously-aspirational "insert-only, application-enforced" contract (`docs/WIX_DATA_SCHEMA.md`) is now genuinely enforced by the one code path that writes to it.

**Deferred, unchanged by this phase:** adding/removing a stage or checklist item; editing intake fields, case types, or a template's own name/enabled flag; reordering that preserves a combined display stage; full optimistic-concurrency retry for version-number races (a same-version collision 409s once rather than auto-retrying, per the ADR's own reasoning on why that's proportionate here).

## Completed: Configurable Intake Form Builder (Phase 19)

**Status: closed 2026-07-23.** Full writeup: [ADR-020](./adr/ADR-020-configurable-intake-form-builder.md).

The New Case intake form is now fully data-driven. `IntakeFieldTemplate` gained `fieldType` (13 supported types), `required`, `defaultValue`, `displayOrder`, `uppercase`, `masked`, `multiline`, `validationType`, and `options` — every property optional, so every pre-existing field (mock fixture and the real Wix template) keeps working with zero migration. `components/modals/NewCaseModal.tsx` no longer hardcodes per-field behavior by literal key name (the old `UPPERCASE_FIELD_KEYS`/`DATE_FIELD_KEYS`/`EXPIRY_FIELD_KEYS` are gone) — it renders and validates purely from each field's own resolved configuration. The Workflow Editor (Phase 18) gained a matching intake-field builder: add/edit/delete/reorder fields, all saved as part of the same new `WorkflowTemplateVersion` as any stage edits. No changes to `Case`, `NewCaseInput`, or the Wix `cases`/`workflowTemplateVersions` schemas were needed — configurable fields either map to an existing structured `Case` property or land in the pre-existing `fieldValues` bucket, exactly as before.

**Deferred, unchanged by this phase:** adding/removing an intake section (only fields within an existing section); editing the template's own name/`isEnabled`/`caseTypes`; live input masking for phone/currency (validation only, no auto-formatting); Phase 18's own deferred items (stage/checklist-item add/remove, combined-display-stage-aware reordering).

**Security follow-up flagged, not implemented (see ADR-020's own section):** payment field (`cardNumber`/`cardExp`/`cardCvv`) persistence is unchanged by this phase and remains a real gap — values are stored as plaintext in `Case.fieldValues`, CVV is retained indefinitely, and the new `masked` property is a UI-only affordance with no encryption or PCI protection behind it. Full card data should eventually route through a PCI-compliant payment provider and be stored only as a token/reference; until then, any new logging/analytics/error-reporting work must explicitly exclude masked/payment fields.

## Version 2 Candidates (not committed, not scheduled)

These are logical next steps once V1 is in production use at Managed Cremations, in roughly the order they'd likely be needed:

- **Real multi-tenant onboarding.** Turning the "architected for it" schema into an actual self-serve or admin-assisted flow for provisioning a second, third, etc. funeral home — organization creation, staff invitation, per-organization SLA/settings configuration (the org switcher becomes real).
- **Service scheduling.** Booking chapels, hearses, crematory slots, and staff time for visitations, funerals, and cremations — likely modeled as its own Wix Data collection(s) alongside `Cases`, with calendar/resource-conflict logic that doesn't exist in V1 at all.
- **Public memorial pages & obituaries.** A public-facing surface (likely a separate, SEO-oriented Next.js route group or site) for publishing service details, guest books, and tribute uploads — this is the point at which the "prioritize authenticated experience over public SEO" decision from V1 gets revisited.
- **Merchandise & payments.** Caskets, urns, flowers, and pre-need/at-need contract payment collection — likely via Wix Stores/Payments given the existing Wix relationship, wired into the `paymentStatus` field that V1 only tracks as a status, not a transaction.
- **Mobile.** The V1 UI is deliberately fixed-width/desktop-only (see [UI_COMPONENTS.md](./UI_COMPONENTS.md)); a responsive or native mobile pass is a distinct, later effort.
- **E-signature integration** for the compliance documents already being tracked (permits, authorizations, contracts) — the document service in V1 stores and audits files but does not collect signatures itself.

## Explicitly Not Planned

Nothing in this document should be read as a commitment to build any V2 item on any particular timeline. This list exists so that V1 decisions (schema shape, folder structure, what's deferred vs. rejected) can be evaluated against where the product is headed, not just where it is today.
