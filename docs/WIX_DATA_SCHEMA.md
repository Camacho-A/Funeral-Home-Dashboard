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

- **Indexes:** unique on `beaconOrganizationId`.
- **Permissions:** backend/Admin only.
- **TS type:** matches `types/organization.ts`'s `Organization` exactly.
- **Mapping:** `id → beaconOrganizationId`, `name → name`, `isActive → isActive`.

## Collection 2 — `organizationMemberships`

**Purpose:** connects an authenticated identity to an organization with a role — the real data source `resolveAuthorizationContext()` (Phase 13) needs; today it reads mock fixtures regardless of `DATA_ADAPTER`. **Ownership:** organization-owned join record. **Retention:** deactivate via `isActive=false`, never hard-deleted (preserves an access audit trail).

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconMembershipId` | Text | Required | Immutable |
| `organizationId` | Text | Required | Immutable — → `organizations.beaconOrganizationId` |
| `userId` | Text | Required | Immutable — Wix member `_id` or a Beacon-issued id; never a `StaffProfile.id` |
| `identitySource` | Text enum (`wix` \| `other`) | Required | Immutable |
| `role` | Text enum (`owner`\|`administrator`\|`caseManager`\|`staff`\|`readOnly`) | Required | Mutable |
| `isActive` | Boolean | Required | Mutable (default `true`) |

- **Indexes:** unique composite `(userId, organizationId)`; index on `organizationId`.
- **Permissions:** backend/Admin only — not even member-self read. A logged-in user must never read their own role or other-org memberships directly; only server code resolves this.
- **TS type:** extends `types/organization.ts`'s `OrganizationMembership` with `beaconMembershipId` and `identitySource` (the existing TS type has no id field of its own today).
- **Mapping:** `organizationId → organizationId`, `userId → userId`, `role → role`, `isActive → isActive`.

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
| `fieldValues` | Object (JSON, index→string) | Required | Mutable — intake-derived fields; never populated with realistic SSNs/medical/payment data, mock or real |
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

## Supporting collections evaluated and not created

| Collection | Verdict | Reason |
|---|---|---|
| `users` / `userProfiles` | Not created | Real identity already lives in Wix Members (real login) or mock fixtures (mock mode). A parallel Wix Data collection would duplicate identity data Wix already manages. |
| `caseTimelineEvents` | Not created | `domain/cases/timeline.ts`'s activity log is fully derived at read time from `checklistState`/`fieldValues`/`workflowSnapshot`. No persisted timeline record exists anywhere today; adding one now would be a collection built for a future possibility, not a present need. |
| `caseDocuments` metadata | Not created | Already out of Wix's scope by prior architecture — `types/document.ts` documents this belongs to "eventually the Postgres/object-storage service... not Wix Data." Not a new decision here. |
| `auditEvents` | Not created | No such concept exists in the application today; nothing in the stated Phase 15/16 foundation requires one yet. |
| `staffProfiles` | Not created (recommended retirement) | Rather than a seventh collection duplicating `organizationMemberships`, the recommendation is to unify on one identity directory. Not implemented this phase — see "Open design decision" above. |

## Permissions summary (all seven collections)

No public write access, no unauthenticated read access, no member-self read access. Backend (API-Key-authenticated) access only. Nothing here needs to be broader: Beacon's browser code never talks to Wix Data directly — every read/write, once wired in a later phase, goes through Beacon's own Next.js server code, which resolves and enforces `organizationId` first. This matches `lib/wixClient.ts`'s existing `ApiKeyStrategy` pattern from Phase 12; no new authorization strategy is needed for these collections.

## Indexes summary

| Access pattern | Index |
|---|---|
| Organization-scoped case lists | `cases (organizationId, isArchived)` |
| Case lookup by Beacon case ID + organizationId | `cases (beaconCaseId, organizationId)` unique |
| Cases by current stage | `cases (organizationId, currentStage)` |
| Cases by handler | `cases (organizationId, caseHandlerId)` |
| Tasks by organization and status | `tasks (organizationId, isDone)` |
| Membership lookup by authenticated identity | `organizationMemberships (userId, organizationId)` unique |
| Enabled workflow templates by organization and case type | `workflowTemplates (organizationId, isEnabled)` + `caseTypes` |

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
