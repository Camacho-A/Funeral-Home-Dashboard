# ADR-024: Organization Onboarding and Tenant Provisioning

**Status:** Accepted
**Date:** 2026-07-24

## Context

Every prior phase treated Manor's Cremation as a given: `organizationId = 'managed-cremations'` exists, its workflow template exists, its service catalog exists, its Clover integration row exists — all seeded directly against Wix Data via `curl`, never through application code. There was no path for a *second* funeral home to reach that same state without a developer manually repeating that seeding by hand. This phase builds that path: a versioned onboarding flow that takes a brand-new tenant from nothing to a fully provisioned, launch-ready organization, while never touching Manor's own already-working configuration.

## Onboarding state model

Two records track progress, deliberately kept separate from the records they provision:

- **`OnboardingSession`** (`status: 'not_started' | 'in_progress' | 'blocked' | 'completed'`, `currentStep`, `completedSteps: OnboardingStepKey[]`) — the durable answer to "how far has this organization gotten." Never inferred by scanning which provisioning rows happen to exist; a step is only "completed" once its own Route Handler explicitly marks it so (`markStepCompleted`).
- **`Organization.status`** (`'draft' | 'onboarding' | 'active' | 'suspended' | 'archived'`) — the tenant's own lifecycle, richer than the pre-existing `isActive: boolean`, which is kept in sync (`isActive = status === 'active'`) rather than derived from it at read time, so every pre-Phase-20 caller reading only `isActive` (`lib/auth/authorize.ts`'s `resolveAuthorizationContext`, most notably) keeps working completely unchanged.

An organization is `draft` for the brief window between its row being reserved and its profile actually being written, `onboarding` for the entire rest of the flow, and `active` only once `completeOnboarding` succeeds. Nothing else ever sets `active`.

## Extending the existing `organizations` collection, not creating a conflicting one

Phase 14A already created a live `organizations` Wix collection (`beaconOrganizationId`/`name`/`isActive`) and Phase 15A already reads it — but nothing had ever written to it before this phase. Rather than create a second, differently-shaped collection under the same conceptual name, this phase extended the existing one (`PUT /wix-data/v2/collections`, revision 1→2, the same full-field-list pattern every prior schema change in this project has used) with nine new optional fields (`legalName`, `slug`, `status`, `timezone`, `defaultCurrency`, `primaryEmail`, `primaryPhone`, `website`, `createdAt`/`updatedAt`). Every new field is read defensively in `lib/wixOrganizationMapper.ts` — a pre-Phase-20 row (Manor's own, before its own migration ran) maps successfully with the new fields simply absent, never a mapping failure.

`organizations` had already spent its one allowed unique index on `beaconOrganizationId` (confirmed empirically: Wix Data caps a collection at exactly one unique index, and `organizations` already had one) — `slug` uniqueness is therefore enforced by a regular index plus an application-level check-before-insert retry loop (`generateUniqueSlug`), the same class of accepted limitation already documented for `organizationMemberships(userId, organizationId)` and `workflowTemplateVersions(beaconTemplateId, version)`.

## Provisioning idempotency

Every `organizationProvisioningService.ts` function is safe to call more than once, by one of two mechanisms depending on whether a real unique-index-backed guarantee is available:

1. **Atomic insert-and-catch-409**, where a unique index exists: `startOnboarding` claims a fresh `OnboardingSession` keyed by a client-supplied `idempotencyKey` (a new field, added to `onboardingSessions` beyond this phase's own literal field list, for the same reason `paymentRecords.idempotencyKey` was added in Phase 19B — a retried `/start` call returns the *same* session and organization, never a duplicate tenant). `createPaymentIntegrationPlaceholder` reuses Phase 19B's existing `{organizationId}-{provider}` natural-key convention directly.
2. **Look-up-before-insert**, where no client-supplied token is needed because the organization's own existing state *is* the idempotency key: `createPrimaryLocation`, `assignInitialAdministrator`, `provisionWorkflow`, and `seedServiceCatalog` each provision at most one thing per organization during onboarding — a retry finds the already-provisioned row and returns it unchanged, since a genuine second call has no way to distinguish "primary location" from "second primary location" other than by there already being one.

`saveBranding` is the one exception worth naming explicitly: it's a plain upsert, not idempotent in the "reject a duplicate" sense — branding is editable, not historical, so calling it again with different values is expected to update, not to be rejected.

## Starter-template ownership: in-code content, not a shared Wix row

"Never share a mutable workflow instance between organizations" ruled out the obvious approach of giving a "starter" `WorkflowTemplate` its own live Wix row that every onboarding organization's version pointed back at — that's exactly a shared mutable instance. Instead, `domain/onboarding/starterWorkflow.ts` (`STARTER_WORKFLOW`, `MINIMAL_WORKFLOW`) and `domain/onboarding/starterServiceCatalog.ts` are plain in-code data, never persisted anywhere themselves. `provisionWorkflow`/`seedServiceCatalog` materialize this content into a genuinely new, organization-owned `WorkflowTemplate`/`WorkflowTemplateVersion`/`serviceCatalog` row set — the organization never reads the template module again after provisioning, the same one-time-copy guarantee `CaseWorkflowSnapshot` already gives individual cases.

`'clone_existing'` mode copies another already-existing template's latest version by value (`structuredClone`, not a shared reference) — verified by a dedicated test that mutating the clone's `stages` array never touches the source template's own data. There is no independent `isApproved` flag anywhere in the schema; in practice "an existing approved template" means whichever template id the platform administrator running onboarding chooses to name, since no separate approval workflow exists to enforce a narrower policy — noted here rather than silently assumed.

The starter service catalog reuses Manor's Cremation's exact five v1 service codes/prices as the default for every new tenant, a deliberate simplification given no other reference pricing exists in this project yet — every organization still gets its own independent rows (never a reference to Manor's), just with the same starting numbers.

## Never trusting `organizationId` from the request body

Every onboarding Route Handler other than `/start` accepts an `onboardingSessionId` — an opaque, server-generated id — and nothing else identifies which organization is being acted on. `lib/onboarding/routeHelpers.ts`'s `resolveOnboardingSessionAccess` looks the session up server-side and reads *its own* `organizationId` field; the client's only lever is which session id it names, and `lib/auth/requireOnboardingAccess.ts` then decides whether the caller may act on that specific session. This is the same "never trust organizationId supplied by the browser" principle every other Route Handler in this project already follows (`requireAuthorizedOrganization`), applied to a case that principle's existing mechanism can't directly cover — no membership can exist yet for most of this flow.

## Failure recovery: idempotent reconciliation, never a cross-collection rollback

Per this phase's own explicit instruction, no code path here ever attempts to undo an already-created durable record when a *later* step fails. If `startOnboarding`'s session claim succeeds but the organization insert that follows genuinely fails (a rare write error, not a routine race), the broken pairing is left as-is — a retry with the same `idempotencyKey` finds the existing session, discovers its organization is missing, and creates it now using the session's own already-fixed `organizationId`. The same principle holds throughout: `completeOnboarding` re-validates every required piece of state fresh (`validateLaunchReadiness`) rather than trusting a client's claim about which steps finished, and rejects activation outright (never partially) when anything is missing.

## Manor's Cremation migration

Manor's Cremation predates this phase's onboarding flow entirely — its organization row, workflow, service catalog, and Clover integration all already existed. `migrateExistingOrganization` (in the same service module, reusing every idempotent primitive above) does not recreate any of them: it backfills only the organization profile fields Manor's row didn't already have (never overwriting `name`/`isActive`, which already had real values), creates the one genuinely new record Manor's never had (`OrganizationLocation` — that collection didn't exist before this phase), and *confirms and reports* the rest (workflow, catalog, Clover integration) without writing to any of them. A `completed`-status `OnboardingSession` and an audit entry record that the migration ran. Run live against Wix on 2026-07-24 — see the phase report for the exact resulting record ids — and tested for idempotency by both a full mock-mode suite and (by construction) the same look-up-before-write logic every other provisioning function already relies on.

## Security boundaries

- **Platform administrator is a separate, minimal mechanism** (`lib/auth/platformAdmin.ts`), not a new role on `OrganizationMembership` — see `docs/AUTHENTICATION.md`'s own updated section.
- **No Clover secret is ever accepted or stored** — `createPaymentIntegrationPlaceholder` only ever persists env-var *reference names*, reusing Phase 19B's existing `PaymentIntegration` shape unchanged; the integration it creates always starts `isEnabled: false`.
- **No binary logo data is accepted** — `OrganizationBranding.logoUrl` is structurally a URL string; there is no field capable of holding decoded image bytes.
- **`assignInitialAdministrator` can only ever grant the literal `'administrator'` role** — there is no parameter through which a caller could request any other role, satisfying "Do not allow the client to assign arbitrary platform-level permissions" structurally.
- **Cross-organization isolation is verified, not assumed** — dedicated tests confirm a `CaseOrder`-style guarantee holds here too: an `OrganizationMembership`/`OrganizationLocation`/`OrganizationBranding` row created for one organization is invisible to, and unaffected by, provisioning calls against a different organization, even when both reference the same `userId`.

## Deferred

- A real catalog-/workflow-management admin UI for an organization to edit what onboarding seeded — same pre-existing gap this project has left open since Phase 19C, not newly introduced here.
- Logo file upload / object storage integration — `logoUrl` is ready to receive one once that infrastructure exists.
- A genuine cross-organization "approved template" policy (today, any existing template id can be named as a clone source).
- Email invitations for a newly-assigned administrator who doesn't yet have any Beacon/Wix identity — `assignInitialAdministrator` assumes `administratorUserId` already refers to someone who can log in.
