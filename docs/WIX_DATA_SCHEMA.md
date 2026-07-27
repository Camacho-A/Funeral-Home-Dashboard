# Wix Data Schema (Phase 14)

This document is the authoritative, source-controlled specification of the Wix Data collections backing Beacon's Wix integration — six approved for Beacon's first backend integration (Phase 14A), plus `caseSequences` (Collection 7, Phase 16B). It supersedes `docs/CMS_SCHEMA.md`'s `Cases`, `CaseTasks`, and `StaffProfiles` sections for the collections defined here (that document predates both Phase 11's workflow templates and Phase 13's authentication model, and its field lists no longer match reality — see "Migration notes" below). See [ADR-009](./adr/ADR-009-wix-data-schema.md) for why this shape was chosen, and [ADR-018](./adr/ADR-018-case-number-generation.md) for `caseSequences`.

**Status: created in Wix (Phase 14A, 2026-07-21).** All six collections, and all planned indexes except one (see "Index limits discovered" below), were created in the Beacon Development Wix site via the Wix Data REST API (`https://www.wixapis.com/wix-data/v2/collections`, `/wix-data/v2/indexes`), authenticated with a local, gitignored API key never printed or committed. No Wix MCP tool was used or became available — creation was done via direct REST calls instead. See "Creation record" below for exact resource IDs.

## Creation record (Phase 14A, 2026-07-21)

| Collection | Wix `collectionType` | Fields (incl. 4 system fields) | Indexes created | Permissions |
|---|---|---|---|---|
| `organizations` | NATIVE | 3 + 4 | `unique_beaconOrganizationId` (unique) | insert/update/remove/read: ADMIN |
| `organizationMemberships` | NATIVE | 6 + 4 | `userId_organizationId` (regular, composite) | ADMIN ×4 |
| `workflowTemplates` | NATIVE | 6 + 4 | `unique_beaconTemplateId` (unique), `organizationId_isEnabled` (regular) | ADMIN ×4 |
| `workflowTemplateVersions` | NATIVE | 6 + 4 (all 6 custom fields `immutable: true`) | `beaconTemplateId_version` (regular, `version` DESC) | ADMIN ×4 |
| `cases` | NATIVE | 29 + 4 (9 fields `immutable: true`, incl. `intakeOwnerId`; `caseHandlerId` confirmed NOT immutable) | `organizationId_isArchived`, `organizationId_currentStage`, `organizationId_caseHandlerId` (all regular) | ADMIN ×4 |
| `tasks` | NATIVE | 7 + 4 | `organizationId_isDone` (regular), `caseId` (regular) | ADMIN ×4 |

Verified via a read-only `listDataCollections` call immediately after creation: exactly 10 collections exist in the site — the 4 pre-existing Wix Members system collections (`Members/Badges`, `Members/FullData`, `Members/PrivateMembersData`, `Members/PublicData`, untouched) plus these 6 new ones. No other collection was created, modified, or deleted.

### Corrections discovered during creation (updating this document's earlier proposal)

- **Wix Data *does* support native field-level immutability** (`immutable: true` per field), applied to `intakeOwnerId`, `workflowTemplateVersions`' 6 fields, and other append-only-by-design fields. This is a real database-level guarantee, not purely application-enforced as this document originally assumed — corrected in "Known limitations" below. It does not, by itself, prevent deleting an entire item (that's controlled by the collection's `remove` permission, set to `ADMIN` here).
- **Wix Data caps each collection at 3 regular indexes + 1 unique index** (confirmed from the created collections' own `capabilities.indexLimits`). `cases` was originally proposed with 4 regular indexes; the fourth (case lookup by `beaconCaseId` + `organizationId`) was dropped in favor of a documented Phase 15 implementation note: set the Wix item's own system `_id` equal to `beaconCaseId` at insert time, so single-case lookup is served by Wix's own system index on `_id` at no extra index cost, combined with an `organizationId` check in the query for isolation.
- **True composite-unique constraints are not supported** — Wix's `unique` index option accepts exactly one field. `organizationMemberships (userId, organizationId)` and `workflowTemplateVersions (beaconTemplateId, version)` are therefore **regular** (non-unique) composite indexes for query performance; actual uniqueness for both pairs remains application-enforced (check-before-insert), exactly as this document's original "Known limitations" anticipated as a fallback.
- **`caseTypes` contains-match indexing** was not attempted — array-field indexes aren't part of this API's index model; the documented application-layer fallback (filter in code after an `organizationId`-indexed query) stands as originally planned.

**This phase is schema-only.** No application code reads or writes any of these collections. `DATA_ADAPTER=mock` remains the default and the only functioning mode; every `services/*` function still reads `services/__mocks__/fixtures.ts`.

## Creation record (Phase 16B, 2026-07-23)

`caseSequences` (Collection 7) was created the same way, via the same REST endpoint, using the same gitignored API key: 3 fields (`organizationId`, `year`, `nextSequence`) + 4 system fields, permissions `ADMIN` ×4, no additional indexes (every access is `_id`-scoped). Verified via a follow-up `listDataCollections` call: 11 collections total (the same 4 Wix Members system collections + the 6 from Phase 14A + this one). Also added at this time: `cases.caseNumber` (Text, required, immutable) — see Collection 5's field table above.

## Creation record (Phase 19B, 2026-07-24)

`paymentIntegrations` (Collection 8) and `paymentRecords` (Collection 9) were created the same way, via the same REST endpoints, using the same gitignored API key. See [ADR-022](./adr/ADR-022-clover-hosted-checkout-integration.md).

| Collection | Fields (incl. 4 system fields) | Indexes created | Permissions |
|---|---|---|---|
| `paymentIntegrations` | 11 + 4 | none (small, admin-only collection; every access is organizationId+provider scoped and the row count per organization is tiny — see `caseSequences`' identical reasoning) | ADMIN ×4 |
| `paymentRecords` | 20 + 4 | `organizationId_caseId` (regular), `organizationId_providerCheckoutId` (regular), `unique_idempotencyKey` (unique) | ADMIN ×4 |

One row was inserted into `paymentIntegrations`: Manor's Cremation's (`managed-cremations`) Clover sandbox configuration, with `isEnabled: false` and empty reference values — a placeholder awaiting real Clover sandbox credentials, which were not available during this phase (per explicit instruction: "do not connect Manor's production Clover credentials yet," and no sandbox credentials existed either). `merchantIdReference`/`credentialReference`/`webhookSecretReference` name the env vars (`CLOVER_MANORS_SANDBOX_MERCHANT_ID`, `CLOVER_MANORS_SANDBOX_PRIVATE_KEY`, `CLOVER_MANORS_SANDBOX_WEBHOOK_SECRET`) a future setup step should populate — enabling this integration is then a matter of setting those three env vars and flipping `isEnabled` to `true`; no code change.

### Correction pass (2026-07-24, same day)

Three schema changes were made after live empirical testing surfaced two real gaps (see ADR-022's "Idempotency (correction pass)" and "Durable webhook deduplication (correction pass)" sections for the full reasoning):

1. **`paymentRecords` gained an `idempotencyKey` field** (added via `PUT /wix-data/v2/collections`, revision 1→2, resending the full existing field list plus the new one — Wix's "Update Data Collection" replaces the entire `fields` array, so omitting existing fields would have silently dropped them).
2. **The unique index moved from `providerCheckoutId` to `idempotencyKey`.** Wix Data caps a collection at exactly **one** unique index total (confirmed from `capabilities.indexLimits`) — `unique_providerCheckoutId` (created in the original Phase 19B pass) was dropped via `DELETE /wix-data/v2/indexes?dataCollectionId=paymentRecords&indexName=unique_providerCheckoutId` (an asynchronous operation — the index remained in `DROPPING` status for roughly a minute before the slot was actually freed), then `unique_idempotencyKey` was created in its place. `providerCheckoutId` keeps only its existing regular compound index (`organizationId_providerCheckoutId`).
3. **`paymentIntegrations` gained a `merchantIdReference` field** (same `PUT`-with-full-field-list pattern, revision 1→2), and the existing Manor's Cremation row was rewritten to use it (plus the renamed `credentialReference`/`webhookSecretReference` values) in place of the original plain-text `merchantId` field.
4. **A new `webhookEvents` collection (Collection 10) was created** — see its own section below.

Empirically confirmed against the live collections during this pass (not merely assumed):
- Two `paymentRecords` items with the same value in a unique-indexed field — including two **empty strings** — both fail to insert the second one, with HTTP 409 and error code `WDE0123`. This is why `providerCheckoutId` is now seeded with a per-record placeholder (`pending:{id}`) rather than an empty string at creation time.
- A duplicate system `_id` insert (used for `webhookEvents`' fingerprint-as-`_id` dedup design) fails with HTTP 409, error code `WDE0074`.
- A newly-created unique index begins enforcing uniqueness immediately, while its own `status` still reports `BUILDING` (not yet `ACTIVE`) — confirmed by a real duplicate-key insert attempt against `unique_idempotencyKey` shortly after creation.

## Creation record (Phase 19C, 2026-07-24)

`serviceCatalog` (Collection 11), `caseOrders` (Collection 12), `caseOrderLineItems` (Collection 13), and `caseOrderAuditEntries` (Collection 14) were created the same way, via the same REST endpoints, using the same gitignored API key. See [ADR-023](./adr/ADR-023-case-order-pricing-engine.md).

| Collection | Fields (incl. 4 system fields) | Indexes created | Permissions |
|---|---|---|---|
| `serviceCatalog` | 10 + 4 | `organizationId` (regular) | ADMIN ×4 |
| `caseOrders` | 11 + 4 | `organizationId_caseId` (regular) | ADMIN ×4 |
| `caseOrderLineItems` | 10 + 4 | `organizationId_caseOrderId` (regular) | ADMIN ×4 |
| `caseOrderAuditEntries` | 10 + 4 | `organizationId_caseId` (regular) | ADMIN ×4 |

Verified via a follow-up `listDataCollections` call: 15 collections total (the 4 Wix Members system collections + the 10 from Phases 14A/16B/19B + these 4). No unique index was requested for any of these four — unlike `paymentRecords`, none of them has a client-supplied idempotency concept to protect: `serviceCatalog` rows are seeded once by staff/an admin script, and `caseOrders`/`caseOrderLineItems`/`caseOrderAuditEntries` are always server-generated (a fresh UUID minted by the Route Handler), never a value a duplicate request could race on the way `paymentRecords.idempotencyKey` can.

Manor's Cremation's (`managed-cremations`) five-row v1 service catalog was seeded into `serviceCatalog` immediately after creation:

| `serviceCode` | `displayName` | `category` | `pricingType` | `defaultPrice` (cents) | `sortOrder` |
|---|---|---|---|---|---|
| `DIRECT_CREMATION` | Direct Cremation | `base` | `flat` | 89000 | 1 |
| `WEIGHT_SURCHARGE_201_250` | Weight Surcharge (201–250 lb) | `weight_surcharge` | `flat` | 29000 | 2 |
| `WEIGHT_SURCHARGE_251_300` | Weight Surcharge (251–300 lb) | `weight_surcharge` | `flat` | 39000 | 2 |
| `EXTRA_DEATH_CERTIFICATE` | Extra Death Certificate | `addon` | `per_unit` | 2500 | 3 |
| `MAIL_CREMATED_REMAINS` | Mail Cremated Remains | `addon` | `flat` | 18500 | 4 |

No "under 200 lb" row exists — a $0 weight surcharge is nothing to itemize, so the pricing engine (`domain/pricing/calculateOrder.ts`) simply omits a weight-surcharge line item entirely when that tier is selected, rather than the catalog carrying a $0 placeholder row.

## Creation record (Phase 20, 2026-07-24)

`organizationLocations` (Collection 15), `onboardingSessions` (Collection 16), `organizationBranding` (Collection 17), and `onboardingAuditEntries` (Collection 18) were created the same way, via the same REST endpoints, using the same gitignored API key. `organizations` (Collection 1) was extended in place — see its own section above — rather than a new collection being created for it. See [ADR-024](./adr/ADR-024-organization-onboarding-tenant-provisioning.md).

| Collection | Fields (incl. 4 system fields) | Indexes created | Permissions |
|---|---|---|---|
| `organizationLocations` | 15 + 4 | `organizationId_isPrimary` (regular) | ADMIN ×4 |
| `onboardingSessions` | 12 + 4 | `unique_idempotencyKey` (unique), `organizationId` (regular), `startedByUserId` (regular) | ADMIN ×4 |
| `organizationBranding` | 9 + 4 | `organizationId` (regular) | ADMIN ×4 |
| `onboardingAuditEntries` | 5 + 4 | `organizationId` (regular) | ADMIN ×4 |

Verified via a follow-up query: 19 collections total (the 4 Wix Members system collections + the 14 from Phases 14A/16B/19B/19C + these 4). Manor's Cremation's (`managed-cremations`) existing `organizations` row was backfilled with the nine new profile fields (`slug: 'manors-cremation'`, `status: 'active'`, etc.) — its pre-existing `name`/`isActive` values were left untouched — and its migration was run live: a primary `organizationLocations` row was created (Manor's never had one before this phase), its existing `workflowTemplates`/`serviceCatalog`/`paymentIntegrations` rows were confirmed present (none recreated or modified), and a `completed`-status `onboardingSessions` row plus one `onboardingAuditEntries` row were recorded. See the phase report for the exact resulting record ids.

## Creation record (Phase 21, 2026-07-25)

`identities` (Collection 19), `sessions` (Collection 20), `emailVerificationTokens` (Collection 21), `passwordResetTokens` (Collection 22), and `loginActivityEvents` (Collection 23) were created the same way, via the same REST endpoints, using the same gitignored API key. `organizationMemberships` (Collection 2) was extended in place to serve a second, independent row shape — see its own section above for the full story of the name collision this surfaced and how it was resolved. See [ADR-025](./adr/ADR-025-identity-authentication-architecture.md).

| Collection | Fields (incl. 4 system fields) | Indexes created | Permissions |
|---|---|---|---|
| `identities` | 15 + 4 | `unique_normalizedEmail` (unique), `beaconIdentityId` (regular) | ADMIN ×4 |
| `sessions` | 13 + 4 | `identityId` (regular), `beaconSessionId` (regular) | ADMIN ×4 |
| `emailVerificationTokens` | 6 + 4 | `unique_tokenHash` (unique), `identityId` (regular) | ADMIN ×4 |
| `passwordResetTokens` | 6 + 4 | `unique_tokenHash` (unique), `identityId` (regular) | ADMIN ×4 |
| `loginActivityEvents` | 7 + 4 | `identityId` (regular) | ADMIN ×4 |
| `organizationMemberships` (extended) | 10 + 4 (was 6 + 4) | `identityId` (regular, new) added alongside the pre-existing `userId_organizationId` | ADMIN ×4 (unchanged) |

Verified via a follow-up `GET /wix-data/v2/collections` (list): 27 collections total (the 4 Wix Members system collections + the 18 from Phases 14A/16B/19B/19C/20 + these 5 new ones; `organizationMemberships` extended in place, not counted twice). The identity migration (`services/identityMigrationService.ts`'s `migrateExistingUsers`) was run live against `DATA_ADAPTER=wix`, migrating all three named mock identities from `services/__mocks__/authFixtures.ts` (Dana/Manor's Cremation administrator, the multi-org test user, and the inactive-membership test user) into real `identities`/`organizationMemberships` rows — 3 identities created, 4 memberships created (one carried over as `status: 'disabled'`, preserving the legacy inactive row rather than dropping it), 0 pre-existing (the collection held zero rows before this run). Re-run immediately afterward to confirm idempotency: 0 created, all 3 identities / 4 memberships reported as already existing, identical ids returned both times. A full live auth round-trip was also verified for Manor's Cremation's migrated administrator identity: forgot-password token creation, password reset, and both correct- and incorrect-password verification all succeeded against the live collections (that identity's demo password was subsequently rotated during the post-approval security review — see the phase report). See the phase report for exact resulting record ids.

**Cross-cutting principle correction:** point 4 below ("No secrets, tokens, or passwords are stored in any collection") no longer holds universally as of this phase — `identities.passwordHash`/`mfaSecretReference` and `emailVerificationTokens`/`passwordResetTokens`' `tokenHash` are secret-*adjacent* fields (a salted hash, an AES-256-GCM encrypted value, and a SHA-256 hash respectively — never a plaintext password, raw token, or Wix/session credential). The original principle's actual intent — no *plaintext* secret or Wix/session credential ever lands in Wix Data — still holds exactly as stated.

## Cross-cutting principles

1. **Wix metadata is kept separate from Beacon domain identifiers.** Every collection has Wix's own system `_id` (opaque, Wix-managed, never referenced by Beacon code) *and* an explicit `beacon<Thing>Id` text field — a Beacon-generated stable string id matching the existing `id` field on the corresponding `types/*.ts` type. Every cross-collection reference below is a plain text field holding another collection's `beacon<Thing>Id`, not a formal Wix "Reference" field type (which keys off system `_id`) — so Beacon's own code, including `resolveAuthorizationContext`, never has to reason about a Wix-internal identifier.
2. **`organizationId` is required on every organization-owned collection** (all seven below except the top-level identity it establishes in `organizations` itself).
3. **Wix collection permissions are a backstop, not the isolation mechanism.** Every collection defaults to backend/API-Key access only — no Member read, no Visitor read, no public write, not even member-self read. The actual tenant-isolation guarantee is that Beacon's server code always derives `organizationId` from `resolveAuthorizationContext()` (Phase 13) before issuing any query — the same discipline the mock services already apply by filtering `services/__mocks__/fixtures.ts` on `context.organizationId`. If a Wix permission were ever misconfigured, the application-layer check is still what stands between a request and another organization's data.
4. **No secrets, tokens, or passwords are stored in any collection.** Nothing below stores a Wix access/refresh token, a password, or a session-signing secret.

## Open design decision, resolved for this schema

`intakeOwnerId`, `caseHandlerId` (`cases`), and `assigneeId` (`tasks`) reference the **authenticated-identity id space** — the same space as `organizationMemberships.userId` (a Wix member `_id` for real logins, or a Beacon-issued id otherwise) — not the pre-existing `StaffProfile.id` space (`'staff-dana'`, etc.).

This is a deliberate change in direction from what the current codebase actually does: `hooks/useSession.ts` and `services/casesService.ts`'s `create()` still derive `intakeOwnerId`/`assignedStaffId` from a hardcoded `StaffProfile` stub, entirely disconnected from Phase 13's real login. This schema is built for where the domain model is *supposed* to end up (intake ownership tied to who actually authenticated), not where the application code currently is. **Rewiring `useSession()`/`casesService.create()` to derive these from the real session is Phase 15/16 work, not done here** — this phase changes no application code. `StaffProfile` retiring in favor of `organizationMemberships` (one identity directory instead of two) is the recommended direction; it has not been implemented.

## Collection 1 — `organizations`

**Purpose:** canonical registry of tenant organizations. **Ownership:** not organization-owned itself. **Retention:** never hard-deleted; deactivate via `isActive=false`.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconOrganizationId` | Text | Required | Immutable |
| `name` | Text | Required | Mutable |
| `isActive` | Boolean | Required | Mutable (default `true`) |
| `legalName` | Text | Optional (Phase 20) | Mutable |
| `slug` | Text | Optional (Phase 20) | Mutable while `status` is `draft`/`onboarding`; immutable once `active` by convention (not Wix-enforced) |
| `status` | Text (`draft`/`onboarding`/`active`/`suspended`/`archived`) | Optional (Phase 20) | Mutable |
| `timezone` | Text | Optional (Phase 20) | Mutable |
| `defaultCurrency` | Text | Optional (Phase 20) | Mutable |
| `primaryEmail`, `primaryPhone` | Text | Optional (Phase 20) | Mutable |
| `website` | Text, nullable | Optional (Phase 20) | Mutable |
| `createdAt`, `updatedAt` | Text | Optional (Phase 20) | `createdAt` immutable, `updatedAt` mutable |

- **Indexes:** unique on `beaconOrganizationId` (pre-existing — occupies this collection's one allowed unique-index slot, confirmed empirically); regular index on `slug` (Phase 20, since a second unique index isn't available).
- **Permissions:** backend/Admin only.
- **TS type:** `types/organization.ts`'s `Organization` — the nine Phase 20 fields are all optional, so a pre-Phase-20 record (or a not-yet-migrated live row) remains fully valid.
- **Mapping:** `id → beaconOrganizationId`, `name → name`, `isActive → isActive`, plus a direct field-for-field mapping for every Phase 20 addition.
- **Phase 20 correction (2026-07-24):** this collection's fields were extended via `PUT /wix-data/v2/collections` (revision 1→2, resending the full existing field list plus the nine new ones — Wix's "Update Data Collection" replaces the entire `fields` array, so omitting existing fields would have silently dropped them) rather than creating a second, conflicting `organizations`-shaped collection. See [ADR-024](./adr/ADR-024-organization-onboarding-tenant-provisioning.md).

## Collection 2 — `organizationMemberships`

**Purpose:** connects an authenticated identity to an organization with a role. **Ownership:** organization-owned join record. **Retention:** never hard-deleted (preserves an access audit trail).

**Phase 21 correction (2026-07-25): this collection now holds two independent row shapes side by side, discovered and resolved during Phase 21's live-Wix step.** The Phase 21 identity system's own `services/membershipService.ts`/`lib/wixMembershipMapper.ts` were designed and built (Task 130/131) under the mistaken belief that no live Wix collection named `organizationMemberships` existed yet — `lib/auth/authorize.ts`'s pre-existing comment ("no real Wix membership data collection exists yet") was accurate about *no code reading it*, not about the collection's *existence*: it was in fact created back in Phase 14A and has sat empty and unread ever since. This was only caught at Phase 21's own live-verification step (this document's own Phase 14A record, above, was the tell), not during design — flagged and resolved with the user before any live schema change was made. The user's explicit choice: **extend the existing collection's schema to serve both models, rather than route Phase 21 into a differently-named collection.**

Concretely: the six original fields (`beaconMembershipId`, `organizationId`, `userId`, `identitySource`, `role`, `isActive`) were resent via `PUT /wix-data/v2/collections` (revision 1→2) with `userId`/`identitySource`/`isActive` relaxed from `required: true` to `required: false` (a Phase 21 row has none of the three), alongside six new fields for the Phase 21 `Membership` model. `beaconMembershipId`, `organizationId`, and `role` are shared verbatim between both models — same meaning, same 5-value role enum — so they were left untouched. Live-verified with zero data loss: the collection held **zero rows** at the time of this change (confirmed via a query immediately before extending it), so there was no existing data to migrate or risk.

| Field | Type | Required | Mutable | Model |
|---|---|---|---|---|
| `beaconMembershipId` | Text | Required | Immutable | Shared |
| `organizationId` | Text | Required | Immutable — → `organizations.beaconOrganizationId` | Shared |
| `role` | Text enum (`owner`\|`administrator`\|`caseManager`\|`staff`\|`readOnly`) | Required | Mutable | Shared |
| `userId` | Text | Optional (Phase 21 correction: was Required) | Immutable — Wix member `_id` or a Beacon-issued id; never a `StaffProfile.id` | Legacy (`AUTH_ADAPTER=mock\|wix`) |
| `identitySource` | Text enum (`wix` \| `other`) | Optional (Phase 21 correction: was Required) | Immutable | Legacy |
| `isActive` | Boolean | Optional (Phase 21 correction: was Required) | Mutable (default `true`) | Legacy |
| `identityId` | Text | Optional | Immutable — → `identities.beaconIdentityId` | Phase 21 |
| `status` | Text enum (`invited`\|`active`\|`disabled`\|`removed`) | Optional | Mutable | Phase 21 |
| `invitedBy` | Text, nullable | Optional | Immutable — the inviting identity's id | Phase 21 |
| `joinedAt` | Text (ISO timestamp), nullable | Optional | Mutable — set once on `invited`→`active` | Phase 21 |
| `createdAt`, `updatedAt` | Text (ISO timestamp) | Optional | `createdAt` immutable, `updatedAt` mutable | Phase 21 |

- **Indexes:** `userId_organizationId` (regular composite, pre-existing) plus a new `identityId` (regular, Phase 21) — 2 of 3 regular index slots now used, 0 of 1 unique. A row belongs to exactly one model at a time in practice (an application-level convention, not a database constraint Wix Data can express across two disjoint field sets); `services/membershipService.ts` only ever reads/writes the Phase 21 fields, `lib/auth/authorize.ts`'s `resolveAuthorizationContext` still reads mock fixtures unchanged and has never queried this collection at all (unaffected either way).
- **Permissions:** backend/Admin only, unchanged.
- **TS types:** legacy rows map to `types/organization.ts`'s `OrganizationMembership`; Phase 21 rows map to `types/membership.ts`'s `Membership` (see that file's own comment on why these are two deliberately separate types, not a shared one).

## Collection 3 — `workflowTemplates` (template identity)

**Purpose:** template identity, kept separate from version identity. **Ownership:** organization-owned, unless `isSystemTemplate=true`. **Retention:** deactivate via `isEnabled=false`; never hard-deleted (existing case snapshots must remain resolvable by id even if a template is retired).

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconTemplateId` | Text | Required | Immutable |
| `organizationId` | Text | Required unless `isSystemTemplate=true` (app-enforced; Wix Data has no native conditional-required constraint) | Immutable |
| `isSystemTemplate` | Boolean | Required | Immutable (default `false`) |
| `name` | Text | Required | Mutable |
| `isEnabled` | Boolean | Required | Mutable (default `true`) |
| `caseTypes` | Array\<Text\> | Required | Mutable |

- **Indexes:** unique on `beaconTemplateId`; composite `(organizationId, isEnabled)`. `caseTypes` indexed for contains-match filtering alongside `organizationId` — true composite indexing over an array field may not be supported by Wix Data; to confirm against the actual collection editor once created, falling back to an app-layer `caseTypes.includes(...)` filter combined with the `organizationId` index query if not.
- **Permissions:** backend/Admin only.
- **TS type:** matches `WorkflowTemplate` minus its inline `versions` array (moved to Collection 4).
- **Mapping:** `id → beaconTemplateId`, `organizationId → organizationId`, `name → name`, `isEnabled → isEnabled`, `caseTypes → caseTypes`.

## Collection 4 — `workflowTemplateVersions` (version identity, immutable)

**Purpose:** append-only historical versions — the actual mechanism that guarantees existing cases never depend on later template edits. **Ownership:** belongs to one `workflowTemplates` row; inherits org scope through its parent. **Retention:** never deleted, never updated after creation.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconTemplateId` | Text | Required | Immutable — → `workflowTemplates.beaconTemplateId` |
| `version` | Number | Required | Immutable — starts at 1, increments |
| `caseTypes` | Array\<Text\> | Required | Immutable |
| `stages` | Object (JSON) | Required | Immutable — serialized `StageTemplate[]` |
| `intake` | Object (JSON) | Required | Immutable — serialized `IntakeTemplate` |
| `createdAt` | Date | Required | Immutable |

- **Indexes:** unique composite `(beaconTemplateId, version)`; `(beaconTemplateId)` sorted descending by `version` for latest-version lookups.
- **Permissions:** backend/Admin only.
- **Immutability caveat:** Wix Data has no native "insert-only" enforcement. This collection's append-only guarantee **must be enforced at the application service layer** — only ever call insert against it, never update — the same way `types/workflowTemplate.ts` already documents versions as "append-only" by convention today. **Update (Phase 18):** this is no longer purely aspirational — `app/api/workflow-templates/[templateId]/versions/route.ts` is now the one code path that writes here, and it only ever calls `insertWixDataItem`, never `updateWixDataItem`. See [ADR-019](./adr/ADR-019-workflow-management.md).
- **TS type:** matches `WorkflowTemplateVersion` exactly.
- **Mapping:** direct field-for-field.
- **Item `_id` (Phase 18):** set to `` `${beaconTemplateId}-v${version}` `` at insert time — the same "system id doubles as the natural key" convention `cases`/`tasks`/`caseSequences` already use — so a same-version race between two concurrent edits collides on Wix's own `_id` uniqueness (409) instead of silently creating two rows both claiming the same version number.
- **`intake` internal shape (Phase 19):** `IntakeFieldTemplate` gained several new optional properties (`fieldType`, `required`, `displayOrder`, `uppercase`, `masked`, `validationType`, `options`, ...) — see [ADR-020](./adr/ADR-020-configurable-intake-form-builder.md). Since `intake` is stored as one opaque JSON object (not broken into its own fields/columns here), **this required zero schema change to this collection** — the new properties simply ride along inside the same JSON blob this collection already stores.

## Collection 5 — `cases`

**Purpose:** the core case record. **Ownership:** organization-owned. **Retention:** soft-delete only, via `isArchived`; never hard-deleted.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconCaseId` | Text | Required | Immutable |
| `organizationId` | Text | Required | Immutable |
| `caseNumber` | Text | Required | **Immutable** — the human-facing `B{YYYY}-{###}` identifier (Phase 16B); always read-only in the application, generated once at creation via `caseSequences` (Collection 7) and never reassignable — see [ADR-018](./adr/ADR-018-case-number-generation.md) |
| `caseType` | Text | Required | Immutable |
| `workflowTemplateId` | Text | Required | Immutable — → `workflowTemplates.beaconTemplateId` |
| `workflowTemplateVersion` | Number | Required | Immutable |
| `workflowSnapshot` | Object (JSON) | Required | Immutable — full `CaseWorkflowSnapshot`, embedded |
| `intakeOwnerId` | Text | Required | **Immutable** — authenticated-identity id; see "Open design decision" above |
| `caseHandlerId` | Text (nullable) | Optional | **Mutable** — freely reassignable; maps to today's `assignedStaffId` |
| `currentStage` | Number | Required | Mutable — → `rawStage` |
| `checklistState` | Object (JSON, index→bool) | Required | Mutable |
| `fieldValues` | Object (JSON, index→string) | Required | Mutable — intake-derived fields; never populated with realistic SSNs/medical data, mock or real. Payment data (PAN/CVV/expiration) is structurally excluded, not just a fixture convention — see [ADR-021](./adr/ADR-021-secure-payment-architecture.md) |
| `decedentName`, `dateOfBirth`, `dateOfDeath`, `timeOfDeath`, `placeOfDeath`, `weight`, `nextOfKinName`, `nextOfKinPhone` | Text | Required | Mutable |
| `paymentStatus` | Text enum | Required | Mutable |
| `isVeteran` | Boolean | Required | Mutable |
| `vaStepsState` | Object (JSON) | Optional | Mutable |
| `vaPublishChoice` | Text enum, nullable | Optional | Mutable |
| `daysWaitingInStage`, `isStalled`, `stalledReason` | Number/Boolean/Text | Optional | Mutable |
| `createdBy` | Text | Required | Immutable — same identity-space note as `intakeOwnerId` |
| `isArchived` | Boolean | Required | Mutable — → `isDeleted` |
| `createdAt` | Date | Required | Immutable |

- **References:** `organizationId → organizations`; `workflowTemplateId → workflowTemplates`; `intakeOwnerId`/`caseHandlerId`/`createdBy` → the authenticated-identity space (see "Open design decision").
- **Indexes:** unique composite `(beaconCaseId, organizationId)`; `(organizationId, currentStage)`; `(organizationId, caseHandlerId)`; `(organizationId, isArchived)`.
- **Permissions:** backend/Admin only.
- **TS type:** matches `types/case.ts`'s `Case` field-for-field (see mapping column above; `currentStage`/`caseHandlerId`/`isArchived` are the only renamed fields, mapping to `rawStage`/`assignedStaffId`/`isDeleted` respectively).

## Collection 6 — `tasks`

**Purpose:** office-wide task list, optionally case-linked. **Ownership:** organization-owned.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconTaskId` | Text | Required | Immutable |
| `organizationId` | Text | Required | Immutable |
| `text` | Text | Required | Mutable |
| `assigneeId` | Text (nullable) | Optional | Mutable — same identity-space note as `caseHandlerId`; maps to today's `assigneeStaffId` |
| `isDone` | Boolean | Required | Mutable (default `false`) |
| `caseId` | Text (nullable) | Optional | Immutable — → `cases.beaconCaseId`; null = general office task |
| `createdAt` | Date | Required | Immutable |

- **Indexes:** composite `(organizationId, isDone)`; `(caseId)`.
- **Permissions:** backend/Admin only.
- **TS type:** matches `types/task.ts`'s `CaseTask` (`assigneeId` renamed from `assigneeStaffId`, per the identity-space direction above — not yet applied to the TS type or any service).

## Collection 7 — `caseSequences`

**Purpose:** backs atomic Case Number generation (Phase 16B) — one row per organization+year, holding the next sequence number to hand out. Not read by any client-facing service; only ever touched by `lib/wixCaseNumberSequence.ts`, server-side, at case-creation time. **Ownership:** organization-owned (one row per organization+year).

| Field | Type | Required | Mutable |
|---|---|---|---|
| `organizationId` | Text | Required | Immutable |
| `year` | Number | Required | Immutable |
| `nextSequence` | Number | Required | Mutable — only ever changed via an atomic `INCREMENT_FIELD` patch, never a plain update |

- **`_id` is set to `{organizationId}-{year}`** at insert time (e.g. `managed-cremations-2026`) — the same "system `_id` doubles as the natural key" convention already used for `cases`/`tasks`, giving free per-organization-per-year uniqueness without a dedicated (and here, unnecessary) unique index.
- **Concurrency safety:** the whole point of this collection. See [ADR-018](./adr/ADR-018-case-number-generation.md) for the full design and the empirical verification (against the live Wix project) that concurrent claims never collide.
- **Indexes:** none needed beyond the system `_id` index — every access is a direct id-scoped PATCH/insert, never a query.
- **Permissions:** backend/Admin only, same as every other collection.
- **TS type:** no corresponding domain type — this collection's shape (`{organizationId, year, nextSequence}`) is internal to `lib/wixCaseNumberSequence.ts` and never surfaces as a `Case`-adjacent domain object.

## Collection 8 — `paymentIntegrations`

**Purpose:** organization-scoped payment-provider configuration (Phase 19B — Clover Hosted Checkout Integration). One row per organization+provider. Never holds a secret value directly — `merchantIdReference`/`credentialReference`/`webhookSecretReference` are all environment-variable *names*, resolved server-side by `lib/clover/cloverConfig.ts`. **Ownership:** organization-owned.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `organizationId` | Text | Required | Immutable |
| `provider` | Text | Required | Immutable |
| `environment` | Text (`sandbox`/`production`) | Required | Mutable |
| `merchantIdReference` | Text | Required | Mutable — an env var *name* (correction pass: originally a plain-text `merchantId`, folded into the same reference pattern as the other two for one consistent resolution mechanism, not because it's actually secret) |
| `credentialReference` | Text | Required | Mutable — an env var *name*, never a secret value |
| `webhookSecretReference` | Text | Required | Mutable — an env var *name*, never a secret value |
| `isEnabled` | Boolean | Required | Mutable |
| `createdAt`, `updatedAt` | Date | Required | `createdAt` immutable, `updatedAt` mutable |

- **`_id` is set to `{organizationId}-{provider}`** at insert time (e.g. `managed-cremations-clover`) — the same natural-key convention as `caseSequences`.
- **No secret ever touches this collection.** See ADR-021/ADR-022's PCI-boundary reasoning — a compromise of this collection's data (or of the Wix API key that can read it) exposes only which env vars to look up, not the secrets themselves.
- **Indexes:** none — see the Creation record above.
- **TS type:** `types/payment.ts`'s `PaymentIntegration`.

## Collection 9 — `paymentRecords`

**Purpose:** one row per payment *attempt* (Phase 19B). A case can have many — deposits, balances, a failed attempt followed by a retry. Provider-neutral, non-sensitive metadata only — no PAN, CVV, expiration, track/PIN data, or raw provider credential ever has a field here (see `lib/paymentFieldGuard.ts`, ADR-021). **Ownership:** organization- and case-scoped.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `organizationId`, `caseId` | Text | Required | Immutable |
| `provider` | Text | Required | Immutable |
| `providerCheckoutId` | Text | Required | Mutable once — seeded with a per-record placeholder (`pending:{id}`), overwritten once Clover assigns a real session id. Correction pass: no longer uniquely indexed (see below) |
| `providerPaymentId` | Text | Optional | Mutable — set once a webhook confirms one exists |
| `idempotencyKey` | Text | Required | Immutable — correction-pass addition; the composed `{organizationId}:{clientKey}` value backing the atomic duplicate-checkout guard (see ADR-022's "Idempotency (correction pass)") |
| `checkoutUrl` | Text | Optional | Mutable — cleared implicitly once a session expires; see types/payment.ts's own comment on why this field exists beyond the phase's original list |
| `status` | Text (`pending`/`succeeded`/`failed`/`cancelled`/`refunded`) | Required | Mutable — only ever transitions forward from `pending`; see `app/api/webhooks/clover/route.ts`'s idempotency handling |
| `amount` | Number | Required | Immutable |
| `currency`, `purpose` | Text | Required | Immutable |
| `cardBrand`, `cardLast4`, `receiptReference`, `failureCode`, `failureMessage` | Text | Optional | Mutable — set from a verified webhook only |
| `createdAt` | Date | Required | Immutable |
| `paidAt`, `updatedAt` | Date | Optional/Required | Mutable |

- **`_id` is set to `beaconPaymentId`** at insert time — the same convention as `cases`/`tasks`, making a single-payment lookup free via Wix's system `_id` index.
- **`unique_idempotencyKey`** (correction pass — replaces the original `unique_providerCheckoutId`) guarantees an organization can never have two `PaymentRecord`s for the same client-supplied idempotency key, enforced atomically by Wix, not by an application-level check-then-insert. Wix caps a collection at exactly one unique index total, which is why `providerCheckoutId` gave up its own unique constraint here — see ADR-022 for the full reasoning and the empirical confirmation that this cap is real (`WDE0141: Index quota exceeded`).
- **`organizationId_caseId`** serves the payment-history list query (`PaymentCard`'s "payment history").
- **`organizationId_providerCheckoutId`** (regular, not unique) serves the org-scoped update-by-checkout-id path (`updatePaymentRecordByCheckoutId`) — correctness there comes from the `idempotencyKey` guard upstream (only one record is ever created per attempt), not from this index enforcing uniqueness itself.
- **TS type:** `types/payment.ts`'s `PaymentRecord`.

## Collection 10 — `webhookEvents`

**Purpose:** durable, cross-instance, restart-surviving processing-lifecycle tracking for Clover webhook deliveries (two correction passes — see ADR-022's "Durable webhook deduplication (two correction passes)"). Not a general audit log — holds only enough to prove "this exact event has (or hasn't) finished processing," nothing about the payment's sensitive-adjacent details. **Ownership:** none (no `organizationId` field) — correlation happens through `providerCheckoutId` for debugging/reference only; the collection's real key is its own `_id`.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `provider` | Text | Required | Immutable |
| `providerCheckoutId` | Text | Required | Immutable — reference only, not the dedup key itself |
| `receivedAt` | Date | Required | Immutable — maps to `WebhookEventRecord.firstReceivedAt`; never changes across a reclaim |
| `state` | Text (`processing`/`completed`/`failed`) | Required | Mutable — added in the final correction pass; see below |
| `attemptCount` | Number | Required | Mutable — starts at 1, incremented on every reclaim |
| `lastAttemptAt` | Date | Required | Mutable — updated on every claim, reclaim, and completion |
| `completedAt` | Date | Optional | Mutable — set only once `state` becomes `completed` |

- **`_id` is set to the event's own `eventFingerprint`** — `sha256(merchantId|checkoutSessionId|paymentId|status)`, computed from the already-signature-verified webhook payload's stable fields, deliberately excluding the delivery timestamp (see `lib/wixWebhookEventMapper.ts`'s own comment for why Clover doesn't supply a usable event id itself). Wix's system `_id` uniqueness — always enforced, confirmed empirically via a duplicate-`_id` insert returning HTTP 409 (`WDE0074`) — is what makes the *initial* claim of a brand-new fingerprint atomic.
- **Final correction pass:** the original design (this collection's first version) treated a successful *insert* as the entire dedup signal — a fingerprint present at all meant "already handled." This conflated *claiming* an event with *completing* it: if the downstream `PaymentRecord` update then failed, the row's mere existence would silently swallow every future retry. `state`/`attemptCount`/`lastAttemptAt`/`completedAt` were added (via the same PUT-full-field-list pattern as every other field addition in this document) so "claimed" and "successfully finished" are distinguishable, durable states — see `services/paymentsService.ts`'s `claimWebhookEvent`/`markWebhookEventCompleted`/`markWebhookEventFailed`.
- **No secret, PAN, or CVV of any kind is ever eligible to reach this collection** — it only ever receives values `app/api/webhooks/clover/route.ts` has already verified via signature and mapped through `cloverProvider.mapProviderPayment`.
- **Indexes:** none beyond the system `_id` index — every access is a direct id-scoped insert or `_id`-filtered query, never a broader scan.
- **TS type:** `types/webhookEvent.ts`'s `WebhookEventRecord`/`WebhookEventState`.

## Collection 11 — `serviceCatalog`

**Purpose:** the organization-scoped catalog of billable services and their server-only prices (Phase 19C — Service Catalog, Case Order & Pricing Engine). The one source of truth `domain/pricing/calculateOrder.ts` reads through `services/pricingService.ts`'s `getServiceCatalog` — never hardcoded in a React component. **Ownership:** organization-owned.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconServiceCatalogId` | Text | Required | Immutable |
| `organizationId` | Text | Required | Immutable |
| `serviceCode` | Text | Required | Immutable — e.g. `DIRECT_CREMATION`; the pricing engine's stable key |
| `displayName` | Text | Required | Mutable |
| `category` | Text (`base`/`weight_surcharge`/`addon`, open-ended) | Required | Mutable |
| `pricingType` | Text (`flat`/`per_unit`, open-ended) | Required | Mutable |
| `defaultPrice` | Number | Required | Mutable — integer cents |
| `isActive` | Boolean | Required | Mutable |
| `sortOrder` | Number | Required | Mutable |
| `createdAt`, `updatedAt` | Date | Required | `createdAt` immutable, `updatedAt` mutable |

- **`_id` is set to a fresh generated id** at insert time (not a natural key — a catalog is small and rarely inserted into after initial seeding, so there's no meaningful collision risk to guard against with a composed `_id`).
- **`category`/`pricingType` are plain text, not a closed enum at the Wix level** — matching `types/serviceCatalog.ts`'s deliberately open typing, so a future pricing rule this phase doesn't anticipate can be added as a new catalog row without a schema change.
- **Indexes:** `organizationId` (regular) — every catalog read is organization-scoped.
- **TS type:** `types/serviceCatalog.ts`'s `ServiceCatalogItem`.

## Collection 12 — `caseOrders`

**Purpose:** the authoritative, itemized pricing record for one case (Phase 19C). Append-only/versioned — editing a case's services never mutates an existing row, it inserts a new one with `version` incremented and marks the row it replaces `status: 'superseded'`. Exactly one row per case has `status: 'active'` at a time. **Ownership:** organization- and case-scoped.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconCaseOrderId` | Text | Required | Immutable |
| `organizationId`, `caseId` | Text | Required | Immutable |
| `status` | Text (`active`/`superseded`) | Required | Mutable — the only field ever changed after insert, aside from `balanceDue` |
| `subtotal`, `discountTotal`, `taxTotal`, `total` | Number | Required | Immutable — fixed at creation time for this version; `discountTotal`/`taxTotal` are always 0 today, reserved for a future feature |
| `balanceDue` | Number | Required | Mutable — refreshed whenever a payment against this case succeeds (`services/pricingService.ts`'s `refreshBalanceForCase`); never recalculated from `total` alone, since it also nets out every succeeded `PaymentRecord` for the case across all versions |
| `version` | Number | Required | Immutable — starts at 1, increments per edit |
| `createdAt`, `updatedAt` | Date | Required | `createdAt` immutable, `updatedAt` mutable |

- **`_id` is set to a fresh generated id** at insert time.
- **Historical immutability is structural, not just a convention:** `subtotal`/`discountTotal`/`taxTotal`/`total`/`version` never change after insert — verified by `services/pricingService.test.ts`'s "never rewrites the superseded version's own totals" test. Only `status` (active→superseded) and `balanceDue` (as payments arrive) are ever updated on an existing row.
- **Indexes:** `organizationId_caseId` (regular) — serves both "get this case's active order" (filtered further by `status: 'active'` in the query) and "list every version" (Collection Detail's future audit/reporting needs).
- **TS type:** `types/caseOrder.ts`'s `CaseOrder`.

## Collection 13 — `caseOrderLineItems`

**Purpose:** the itemized services making up one `CaseOrder` version (Phase 19C). Write-once — created alongside their CaseOrder and never edited or deleted; an edit produces a whole new CaseOrder version with its own fresh line items. **Ownership:** organization-scoped, belongs to one `caseOrders` row.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconLineItemId` | Text | Required | Immutable |
| `organizationId`, `caseOrderId` | Text | Required | Immutable — → `caseOrders.beaconCaseOrderId` |
| `serviceCode` | Text | Required | Immutable — → `serviceCatalog.serviceCode` |
| `description` | Text | Required | Immutable — copied from the catalog's `displayName` at calculation time, so a later catalog rename never retroactively changes a historical order's line item text |
| `quantity` | Number | Required | Immutable |
| `unitPrice`, `lineTotal` | Number | Required | Immutable — `unitPrice` likewise copied from the catalog at calculation time, not a live reference |
| `sortOrder` | Number | Required | Immutable |
| `metadata` | Object (JSON), nullable | Optional | Immutable — reserved for future line-item-specific data; always `null` in this phase's own writes |
| `createdAt` | Date | Required | Immutable |

- **`_id` is set to a fresh generated id** at insert time.
- **Indexes:** `organizationId_caseOrderId` (regular) — serves "list this order version's line items."
- **TS type:** `types/caseOrder.ts`'s `CaseOrderLineItem`.

## Collection 14 — `caseOrderAuditEntries`

**Purpose:** immutable audit trail for edits to a case's services (Phase 19C) — distinct from `caseOrders`' own version history (which records *what the order was*), this records *who changed it, when, and why the total moved*. Append-only. **Ownership:** organization- and case-scoped.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconAuditEntryId` | Text | Required | Immutable |
| `organizationId`, `caseId` | Text | Required | Immutable |
| `caseOrderId` | Text | Required | Immutable — → `caseOrders.beaconCaseOrderId`; the version this entry's change resulted in |
| `action` | Text (open-ended, e.g. `order_created`/`weight_tier_changed`/`death_certificate_quantity_changed`/`mail_cremated_remains_added`/`mail_cremated_remains_removed`) | Required | Immutable |
| `previousValue`, `newValue` | Text, nullable | Optional | Immutable |
| `amountDeltaCents` | Number | Required | Immutable — signed; 0 for the initial `order_created` entry |
| `description` | Text | Required | Immutable — precomposed human-readable line, e.g. `"Changed: Weight, Under 200 lb → 201–250 lb, +$290"`, matching this phase's own spec examples exactly so Case Detail/Print Order can render it with no further formatting |
| `performedBy` | Text | Required | Immutable — the staff member's display name, sourced from the trusted client session at request time; same trust model as `cases.createdBy`/`intakeOwnerId` (see "Open design decision" above) |
| `createdAt` | Date | Required | Immutable |

- **`_id` is set to a fresh generated id** at insert time.
- **Not a fourth collection this phase's own spec explicitly named** — the spec's "New Wix Collections" list named `serviceCatalog`/`caseOrders`/`caseOrderLineItems` only. This collection was added because "Track: user, timestamp, action, previous value, new value" has no clean home in any of those three (their own field lists have no `action`/`previousValue`/`newValue`/`performedBy`), the same judgment call that added `webhookEvents` beyond Phase 19B's own three-collection list. Flagged here for the same reason that addition was flagged in ADR-022.
- **Indexes:** `organizationId_caseId` (regular) — serves "list this case's full audit history," most-recent-first (sorted in application code).
- **TS type:** `types/caseOrderAudit.ts`'s `CaseOrderAuditEntry`.

## Collection 15 — `organizationLocations`

**Purpose:** one or more physical (or mailing-only) locations belonging to an organization, seeded during onboarding's "Primary Location" step (Phase 20). **Ownership:** organization-owned.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconLocationId` | Text | Required | Immutable |
| `organizationId` | Text | Required | Immutable |
| `name` | Text | Required | Mutable |
| `locationType` | Text (`office`/`funeral_home`/`crematory`/`mailing_only`) | Required | Mutable |
| `addressLine1` | Text | Required | Mutable |
| `addressLine2` | Text, nullable | Optional | Mutable |
| `city`, `state`, `postalCode`, `country`, `phone` | Text | Required | Mutable |
| `email` | Text, nullable | Optional | Mutable |
| `isPrimary` | Boolean | Required | Mutable — application-enforced exactly-one-per-organization (no Wix conditional-uniqueness primitive exists) |
| `isActive` | Boolean | Required | Mutable |
| `createdAt`, `updatedAt` | Date | Required | `createdAt` immutable, `updatedAt` mutable |

- **`_id` is set to a fresh generated id** at insert time.
- **Indexes:** `organizationId_isPrimary` (regular) — serves "find this organization's primary location," the one query pattern this collection needs today.
- **TS type:** `types/organizationLocation.ts`'s `OrganizationLocation`.

## Collection 16 — `onboardingSessions`

**Purpose:** the durable record of one organization's progress through onboarding (Phase 20) — see [ADR-024](./adr/ADR-024-organization-onboarding-tenant-provisioning.md)'s "Onboarding state model." **Ownership:** organization-owned (exactly one active/completed session per organization in practice, though nothing prevents more).

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconOnboardingSessionId` | Text | Required | Immutable |
| `organizationId` | Text | Required | Immutable |
| `status` | Text (`not_started`/`in_progress`/`blocked`/`completed`) | Required | Mutable |
| `currentStep` | Text (one of the nine `OnboardingStepKey` values) | Required | Mutable |
| `completedSteps` | Array\<Text\> | Required | Mutable |
| `startedByUserId` | Text | Required | Immutable |
| `startedAt`, `lastSavedAt` | Date | Required | Mutable |
| `completedAt` | Date, nullable | Optional | Mutable — set only once `status` becomes `completed` |
| `version` | Number | Required | Mutable — incremented on every step save |
| `idempotencyKey` | Text | Required | Immutable — client-supplied at `/start` time; not part of this phase's own literal field list, added for the same reason `paymentRecords.idempotencyKey` was in Phase 19B (see ADR-024) |
| `createdAt`, `updatedAt` | Date | Required | `createdAt` immutable, `updatedAt` mutable |

- **`_id` is set to a fresh generated id** at insert time (not `idempotencyKey` itself, so the unique index below can be a plain field index rather than doubling as the system id).
- **`unique_idempotencyKey`** guarantees a retried `/start` call can never create a second tenant for the same logical attempt — the atomic guard `startOnboarding` relies on, identical in mechanism to `paymentRecords.idempotencyKey`.
- **Indexes:** `unique_idempotencyKey` (unique); `organizationId` (regular, serves per-organization lookup); `startedByUserId` (regular, serves the "resume my own in-progress session" convenience in `GET /api/onboarding/session`).
- **TS type:** `types/onboarding.ts`'s `OnboardingSession` (the type itself has no `idempotencyKey` field — it's a write-time-only concern internal to `startOnboarding`, not part of the domain shape every other function passes around).

## Collection 17 — `organizationBranding`

**Purpose:** organization-scoped branding (Phase 20) — logo reference, document colors, email sender name, document footer. **Ownership:** organization-owned, exactly one row per organization.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `organizationId` | Text | Required | Immutable |
| `logoUrl` | Text, nullable | Optional | Mutable — a hosted URL only; this collection has no field capable of holding binary/base64 image data at all |
| `primaryColor`, `secondaryColor`, `accentColor` | Text, nullable | Optional | Mutable |
| `emailFromName` | Text, nullable | Optional | Mutable |
| `documentFooter` | Text, nullable | Optional | Mutable |
| `createdAt`, `updatedAt` | Date | Required | `createdAt` immutable, `updatedAt` mutable |

- **`_id` is set to `organizationId`** at insert time — the same "system id doubles as the natural key" convention `paymentIntegrations`/`caseSequences` already use, giving free per-organization uniqueness with no separate unique index needed.
- **Indexes:** `organizationId` (regular) — not strictly required given the `_id` convention above, but present for query-path consistency with every other organization-scoped collection.
- **TS type:** `types/organizationBranding.ts`'s `OrganizationBranding`.

## Collection 18 — `onboardingAuditEntries`

**Purpose:** immutable audit trail for onboarding/provisioning actions (Phase 20) — organization created, administrator assigned, workflow provisioned, catalog seeded, payment placeholder created, onboarding completed. **Ownership:** organization-owned.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconAuditEntryId` | Text | Required | Immutable |
| `organizationId` | Text | Required | Immutable |
| `actorUserId` | Text | Required | Immutable |
| `action` | Text (open-ended, e.g. `organization_created`/`onboarding_completed`) | Required | Immutable |
| `metadata` | Object (JSON), nullable | Optional | Immutable — non-secret, display-safe key/value context only; never a credential value |
| `timestamp` | Date | Required | Immutable |

- **`_id` is set to a fresh generated id** at insert time.
- **Structurally the same pattern as `caseOrderAuditEntries` (Phase 19C), a genuinely separate collection rather than a literal reuse** — see ADR-024's "Reusing the audit architecture, not the collection."
- **Indexes:** `organizationId` (regular) — serves "list this organization's full onboarding audit history."
- **TS type:** `types/onboardingAudit.ts`'s `OnboardingAuditEntry`.

## Collection 19 — `identities`

**Purpose:** a real, Beacon-owned identity — email/password login, invitations, MFA (Phase 21). Answers "who is this person," never which organizations they belong to or what they can do there. **Ownership:** not organization-scoped — one identity can belong to many organizations via `organizationMemberships`. **Retention:** never hard-deleted; `status: 'deleted'` instead.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconIdentityId` | Text | Required | Immutable |
| `email` | Text | Required | Mutable |
| `normalizedEmail` | Text | Required | Mutable — lowercased/trimmed; the field every uniqueness check keys on |
| `displayName` | Text | Required | Mutable |
| `status` | Text enum (`pending`\|`active`\|`locked`\|`disabled`\|`deleted`) | Required | Mutable |
| `emailVerified` | Boolean | Required | Mutable |
| `passwordVersion` | Number | Required | Mutable — incremented on every password change |
| `mfaEnabled` | Boolean | Required | Mutable |
| `lastLoginAt` | Text (ISO timestamp), nullable | Optional | Mutable |
| `createdAt`, `updatedAt` | Text (ISO timestamp) | Required | `createdAt` immutable, `updatedAt` mutable |
| `passwordHash` | Text, nullable | Optional | Mutable — secret. `{saltHex}:{derivedKeyHex}` via `scryptSync`, never a plaintext password |
| `mfaSecretReference` | Text, nullable | Optional | Mutable — secret. AES-256-GCM encrypted TOTP secret, decryptable only server-side |
| `mfaVerifiedAt` | Text (ISO timestamp), nullable | Optional | Mutable |
| `mfaRecoveryCodeHashes` | Array\<Text\> | Optional | Mutable — secret. SHA-256 hashes only, spliced out as each code is consumed |

- **Indexes:** `unique_normalizedEmail` (unique — the mechanism behind "identity must never be duplicated between organizations": `findOrCreateIdentity` inserts and catches the 409 on a race); `beaconIdentityId` (regular, single-record lookup).
- **Permissions:** backend/Admin only. Never member-self read — even the identity's own row is only ever read through `services/identityService.ts`'s narrow accessors, and secrets (`passwordHash`/`mfa*`) are only ever read/written by `services/passwordService.ts`/`services/mfaService.ts`.
- **TS types:** `types/identity.ts`'s `Identity` (public fields) and `IdentitySecrets` (the four secret fields) — deliberately split into two TS types even though they live on the same Wix row, so no caller of the public accessor can accidentally receive a secret field.

## Collection 20 — `sessions`

**Purpose:** the server-side session *registry* for `AUTH_ADAPTER=identity` logins — makes revocation, "sign out everywhere," sliding expiration, and device listing possible for a session whose signed cookie (`lib/auth/sessionToken.ts`) is otherwise stateless. **Ownership:** identity-owned, not organization-owned (an identity can have sessions with no organization selected yet).

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconSessionId` | Text | Required | Immutable |
| `identityId` | Text | Required | Immutable — → `identities.beaconIdentityId` |
| `organizationId` | Text, nullable | Optional | Mutable — which organization this session is *currently* viewing; null until chosen |
| `deviceId` | Text | Required | Immutable |
| `deviceName` | Text, nullable | Optional | Immutable |
| `ipAddress` | Text, nullable | Optional | Immutable |
| `userAgent` | Text, nullable | Optional | Immutable |
| `expiresAt` | Text (ISO timestamp) | Required | Mutable — sliding, extended on every validated request |
| `lastSeenAt` | Text (ISO timestamp) | Required | Mutable |
| `rememberDevice` | Boolean | Required | Immutable |
| `passwordVersionAtIssue` | Number | Required | Mutable — see `services/sessionService.ts`'s `refreshSessionPasswordVersion`; a mismatch against the identity's current `passwordVersion` invalidates the session regardless of `revokedAt`/`expiresAt` |
| `revokedAt` | Text (ISO timestamp), nullable | Optional | Mutable |
| `createdAt` | Text (ISO timestamp) | Required | Immutable |

- **Indexes:** `identityId` (regular — "list my active sessions"/"sign out everywhere"), `beaconSessionId` (regular — single-session lookup by the signed cookie's own claim).
- **Permissions:** backend/Admin only.
- **TS type:** `types/identitySession.ts`'s `IdentitySession`.

## Collection 21 — `emailVerificationTokens`

**Purpose:** single-use, hashed tokens proving email ownership — drives both plain signup verification and invitation acceptance (see `types/membership.ts`'s comment on why there is no separate invitation-token type). **Ownership:** identity-owned.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconTokenId` | Text | Required | Immutable |
| `identityId` | Text | Required | Immutable |
| `tokenHash` | Text | Required | Immutable — SHA-256 hash only; the raw token is never persisted anywhere |
| `expiresAt` | Text (ISO timestamp) | Required | Immutable |
| `usedAt` | Text (ISO timestamp), nullable | Optional | Mutable — set once, single-use enforcement |
| `createdAt` | Text (ISO timestamp) | Required | Immutable |

- **Indexes:** `unique_tokenHash` (unique — a raw token is 32 random bytes; collision probability is negligible, and uniqueness also serves as a fast, correct lookup), `identityId` (regular).
- **Permissions:** backend/Admin only.
- **TS type:** `types/emailVerificationToken.ts`'s `EmailVerificationToken`.

## Collection 22 — `passwordResetTokens`

**Purpose:** single-use, hashed tokens for the forgot-password flow. **Ownership:** identity-owned. Structurally identical to Collection 21 — a deliberately separate collection rather than one shared token table, so a verification token and a reset token can never be confused with each other by type alone.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconTokenId` | Text | Required | Immutable |
| `identityId` | Text | Required | Immutable |
| `tokenHash` | Text | Required | Immutable |
| `expiresAt` | Text (ISO timestamp) | Required | Immutable |
| `usedAt` | Text (ISO timestamp), nullable | Optional | Mutable |
| `createdAt` | Text (ISO timestamp) | Required | Immutable |

- **Indexes:** `unique_tokenHash` (unique), `identityId` (regular).
- **Permissions:** backend/Admin only.
- **TS type:** `types/passwordResetToken.ts`'s `PasswordResetToken`.

## Collection 23 — `loginActivityEvents`

**Purpose:** the audit trail behind brute-force protection, account lockout, and "Login Activity" (login succeeded/failed, password reset, email verified, invitation accepted, MFA enabled/disabled, session revoked). **Ownership:** identity-owned where known; `identityId`/`organizationId` are both nullable so a failed attempt against an *unknown* email can still be recorded without leaking whether that email exists.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconEventId` | Text | Required | Immutable |
| `identityId` | Text, nullable | Optional | Immutable — null for a failed attempt against an unknown email |
| `organizationId` | Text, nullable | Optional | Immutable |
| `eventType` | Text enum (`login_succeeded`\|`login_failed`\|`password_reset`\|`email_verified`\|`invitation_accepted`\|`mfa_enabled`\|`mfa_disabled`\|`session_revoked`) | Required | Immutable |
| `ipAddress` | Text, nullable | Optional | Immutable |
| `userAgent` | Text, nullable | Optional | Immutable |
| `timestamp` | Text (ISO timestamp) | Required | Immutable |

- **Indexes:** `identityId` (regular — `services/accountRecoveryService.ts`'s `countRecentFailedAttempts` fetches every event for an identity and filters by timestamp in application code, deliberately not relying on an unverified Wix Data range-filter operator).
- **Permissions:** backend/Admin only.
- **TS type:** `types/loginActivityEvent.ts`'s `LoginActivityEvent`.

## Supporting collections evaluated and not created

| Collection | Verdict | Reason |
|---|---|---|
| `users` / `userProfiles` | Not created | Real identity already lives in Wix Members (real login) or mock fixtures (mock mode). A parallel Wix Data collection would duplicate identity data Wix already manages. |
| `caseTimelineEvents` | Not created | `domain/cases/timeline.ts`'s activity log is fully derived at read time from `checklistState`/`fieldValues`/`workflowSnapshot`. No persisted timeline record exists anywhere today; adding one now would be a collection built for a future possibility, not a present need. |
| `caseDocuments` metadata | Not created | Already out of Wix's scope by prior architecture — `types/document.ts` documents this belongs to "eventually the Postgres/object-storage service... not Wix Data." Not a new decision here. |
| `auditEvents` | Not created | No such concept exists in the application today; nothing in the stated Phase 15/16 foundation requires one yet. |
| `staffProfiles` | Not created (recommended retirement) | Rather than a seventh collection duplicating `organizationMemberships`, the recommendation is to unify on one identity directory. Not implemented this phase — see "Open design decision" above. |

## Permissions summary (all twenty-three collections)

No public write access, no unauthenticated read access, no member-self read access. Backend (API-Key-authenticated) access only. Nothing here needs to be broader: Beacon's browser code never talks to Wix Data directly — every read/write, once wired in a later phase, goes through Beacon's own Next.js server code, which resolves and enforces `organizationId` first. This matches `lib/wixClient.ts`'s existing `ApiKeyStrategy` pattern from Phase 12; no new authorization strategy is needed for these collections.

## Indexes summary

| Access pattern | Index |
|---|---|
| Organization-scoped case lists | `cases (organizationId, isArchived)` |
| Case lookup by Beacon case ID + organizationId | `cases (beaconCaseId, organizationId)` unique |
| Cases by current stage | `cases (organizationId, currentStage)` |
| Cases by handler | `cases (organizationId, caseHandlerId)` |
| Tasks by organization and status | `tasks (organizationId, isDone)` |
| Legacy membership lookup by authenticated identity | `organizationMemberships (userId, organizationId)` (regular, not unique — corrected 2026-07-25; empirically re-confirmed non-unique, matching this document's own earlier "true composite-unique constraints are not supported" correction) |
| Phase 21 membership lookup by identity | `organizationMemberships (identityId)` (regular) |
| Enabled workflow templates by organization and case type | `workflowTemplates (organizationId, isEnabled)` + `caseTypes` |
| Atomic duplicate-checkout-attempt prevention (correction pass) | `paymentRecords (idempotencyKey)` unique |
| Payment history for one case | `paymentRecords (organizationId, caseId)` |
| Org-scoped payment update by checkout id | `paymentRecords (organizationId, providerCheckoutId)` (regular, not unique) |
| Durable webhook delivery dedup (correction pass) | `webhookEvents` — system `_id` uniqueness only (`_id` = event fingerprint), no custom index |
| Service catalog by organization | `serviceCatalog (organizationId)` |
| Case order (active + version history) by case | `caseOrders (organizationId, caseId)` |
| Line items for one case order version | `caseOrderLineItems (organizationId, caseOrderId)` |
| Audit history for one case | `caseOrderAuditEntries (organizationId, caseId)` |
| Organization lookup by slug | `organizations (slug)` (regular, not unique) |
| Primary location for one organization | `organizationLocations (organizationId, isPrimary)` |
| Atomic duplicate-onboarding-attempt prevention | `onboardingSessions (idempotencyKey)` unique |
| Onboarding session by organization / by starting user | `onboardingSessions (organizationId)` / `onboardingSessions (startedByUserId)` |
| Branding for one organization | `organizationBranding (organizationId)` |
| Onboarding audit history for one organization | `onboardingAuditEntries (organizationId)` |
| Identity uniqueness + lookup by email | `identities (normalizedEmail)` unique |
| Identity lookup by id | `identities (beaconIdentityId)` |
| Active/all sessions for one identity | `sessions (identityId)` |
| Session lookup by id (from the signed cookie's claim) | `sessions (beaconSessionId)` |
| Email verification token lookup (uniqueness + lookup) | `emailVerificationTokens (tokenHash)` unique |
| Verification tokens for one identity | `emailVerificationTokens (identityId)` |
| Password reset token lookup (uniqueness + lookup) | `passwordResetTokens (tokenHash)` unique |
| Reset tokens for one identity | `passwordResetTokens (identityId)` |
| Login/lockout activity for one identity | `loginActivityEvents (identityId)` |

## Migration notes

- `docs/CMS_SCHEMA.md`'s `Cases`/`CaseTasks`/`StaffProfiles` sections predate Phase 11 (no `workflowTemplateId`/`workflowTemplateVersion`/`workflowSnapshot`) and Phase 13 (no organization-membership or authenticated-identity model), and its `Cases.decedentFirstName`/`decedentLastName` split was never actually implemented — the real `Case` type has always used a single `decedentName`. This document is the current, authoritative source for the six collections it defines; `CMS_SCHEMA.md` is not deleted (it still documents `CaseContacts`/`CaseLogEntries`, which are out of scope here) but should no longer be treated as accurate for `Cases`/`CaseTasks`/`StaffProfiles`.
- No mock data has been or will be migrated into these collections as part of this phase. The only data to be created is one invented reference record: the Managed Cremations workflow template (built from `services/__mocks__/workflowTemplates.ts`, matching its existing v1 shape exactly), once the collections themselves exist.
- Migrating live `cases`/`tasks` fixture data into Wix, and switching any `services/*` function to actually read/write Wix instead of fixtures, is explicitly Phase 15+ work.

## Known limitations

- **All seven collections now exist in Wix** (see "Creation record" sections above) — this limitation from the original proposal is resolved.
- **`workflowTemplateVersions`' append-only guarantee is now field-level database-enforced** (`immutable: true` on all 6 custom fields) **but not item-level.** A field's *value* can't be changed once set, but the collection's `remove` permission (`ADMIN`) still allows deleting an entire version item outright. Application code should still never call `.update()` or `.remove()` against this collection in practice; the field-level flag is a real backstop against accidental value mutation, not a complete guarantee against deletion.
- **The `intakeOwnerId`/`caseHandlerId`/`assigneeId` identity-space decision is not yet reflected in application code.** `hooks/useSession.ts` and `services/casesService.ts` still derive these from a hardcoded `StaffProfile` stub, disconnected from Phase 13's real login. This schema anticipates the eventual fix; the fix itself is not part of this phase.
- **`workflowTemplates.organizationId`'s conditional requirement (required unless `isSystemTemplate=true`) is application-enforced,** not a native Wix Data constraint — implemented as `required: false` at the Wix field level.
- **`cases` has only 3 of its originally-proposed 4 regular indexes** — Wix Data caps every collection at 3 regular + 1 unique index. Case lookup by `beaconCaseId` was deferred to a Phase 16 implementation choice (set the item's own system `_id` to `beaconCaseId` at insert time) rather than a dedicated index — **applied in Phase 16** (`app/api/cases/route.ts`'s `POST` handler; `lib/wixDataApi.ts`'s `insertWixDataItem`), and for the same reason also applied to `tasks`' `beaconTaskId`. Every update/delete still independently re-verifies tenant ownership via a `{beaconCaseId, organizationId}`/`{beaconTaskId, organizationId}` query rather than assuming the convention holds for a given record.
- **Compound-unique constraints are not natively supported** — confirmed, not just suspected: Wix's unique-index option accepts exactly one field. `organizationMemberships (userId, organizationId)` and `workflowTemplateVersions (beaconTemplateId, version)` rely on application-enforced uniqueness (check-before-insert).
- **`caseTypes` contains-match indexing** was not attempted — confirmed out of scope for this index API; the application-layer fallback stands.
- **All newly created indexes were `BUILDING` at creation time**, not yet `ACTIVE` — normal Wix behavior for new indexes; no query depends on them yet since no application code reads or writes these collections.
