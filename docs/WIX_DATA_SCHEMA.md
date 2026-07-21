# Wix Data Schema (Phase 14)

This document is the authoritative, source-controlled specification of the six Wix Data collections approved for Beacon's first backend integration. It supersedes `docs/CMS_SCHEMA.md`'s `Cases`, `CaseTasks`, and `StaffProfiles` sections for the collections defined here (that document predates both Phase 11's workflow templates and Phase 13's authentication model, and its field lists no longer match reality — see "Migration notes" below). See [ADR-009](./adr/ADR-009-wix-data-schema.md) for why this shape was chosen.

**Status: approved, not yet created.** Every collection, field, index, and permission below was reviewed and approved. Actually creating these resources in Wix's Beacon Development project requires either Wix MCP tool access (not available in any Claude Code session to date — see "Known limitations") or manual creation in the Wix dashboard by a human, following this document exactly. Nothing in this document has been created in Wix as of this writing.

**This phase is schema-only.** No application code reads or writes any of these collections. `DATA_ADAPTER=mock` remains the default and the only functioning mode; every `services/*` function still reads `services/__mocks__/fixtures.ts`.

## Cross-cutting principles

1. **Wix metadata is kept separate from Beacon domain identifiers.** Every collection has Wix's own system `_id` (opaque, Wix-managed, never referenced by Beacon code) *and* an explicit `beacon<Thing>Id` text field — a Beacon-generated stable string id matching the existing `id` field on the corresponding `types/*.ts` type. Every cross-collection reference below is a plain text field holding another collection's `beacon<Thing>Id`, not a formal Wix "Reference" field type (which keys off system `_id`) — so Beacon's own code, including `resolveAuthorizationContext`, never has to reason about a Wix-internal identifier.
2. **`organizationId` is required on every organization-owned collection** (all six below except the top-level identity it establishes in `organizations` itself).
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
- **Immutability caveat:** Wix Data has no native "insert-only" enforcement. This collection's append-only guarantee **must be enforced at the application service layer** — only ever call insert against it, never update — the same way `types/workflowTemplate.ts` already documents versions as "append-only" by convention today. This is a real gap, not an oversight; recorded under "Known limitations."
- **TS type:** matches `WorkflowTemplateVersion` exactly.
- **Mapping:** direct field-for-field.

## Collection 5 — `cases`

**Purpose:** the core case record. **Ownership:** organization-owned. **Retention:** soft-delete only, via `isArchived`; never hard-deleted.

| Field | Type | Required | Mutable |
|---|---|---|---|
| `beaconCaseId` | Text | Required | Immutable |
| `organizationId` | Text | Required | Immutable |
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

## Supporting collections evaluated and not created

| Collection | Verdict | Reason |
|---|---|---|
| `users` / `userProfiles` | Not created | Real identity already lives in Wix Members (real login) or mock fixtures (mock mode). A parallel Wix Data collection would duplicate identity data Wix already manages. |
| `caseTimelineEvents` | Not created | `domain/cases/timeline.ts`'s activity log is fully derived at read time from `checklistState`/`fieldValues`/`workflowSnapshot`. No persisted timeline record exists anywhere today; adding one now would be a collection built for a future possibility, not a present need. |
| `caseDocuments` metadata | Not created | Already out of Wix's scope by prior architecture — `types/document.ts` documents this belongs to "eventually the Postgres/object-storage service... not Wix Data." Not a new decision here. |
| `auditEvents` | Not created | No such concept exists in the application today; nothing in the stated Phase 15/16 foundation requires one yet. |
| `staffProfiles` | Not created (recommended retirement) | Rather than a seventh collection duplicating `organizationMemberships`, the recommendation is to unify on one identity directory. Not implemented this phase — see "Open design decision" above. |

## Permissions summary (all six collections)

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

- **The Wix collections described here do not yet exist.** Creating them requires either working Wix MCP tool access (undiscoverable in every Claude Code session to date, despite `claude mcp list` reporting the connection healthy) or manual creation in the Wix dashboard by a human, following this document. A real `WIX_API_KEY` now exists locally (gitignored `.env.local`, verified 2026-07-21 via `GET /api/wix-health` — see `docs/WIX_INTEGRATION.md`), but that verification only exercised a read-only site-properties call; no Data/CMS write capability or programmatic collection-creation path has been attempted or confirmed.
- **`workflowTemplateVersions`' append-only guarantee is application-enforced, not database-enforced.** Wix Data has no native immutability constraint; a future service bug could still call `.update()` against an existing version row. Recorded here rather than assumed away.
- **The `intakeOwnerId`/`caseHandlerId`/`assigneeId` identity-space decision is not yet reflected in application code.** `hooks/useSession.ts` and `services/casesService.ts` still derive these from a hardcoded `StaffProfile` stub, disconnected from Phase 13's real login. This schema anticipates the eventual fix; the fix itself is not part of this phase.
- **`workflowTemplates.organizationId`'s conditional requirement (required unless `isSystemTemplate=true`) is application-enforced,** not a native Wix Data constraint.
- **Compound-unique and array-field indexing support** (`(beaconCaseId, organizationId)`, `caseTypes` contains-match combined with `organizationId`) needs confirming against the actual Wix Data collection editor once created; a documented application-layer fallback exists for each case where Wix Data doesn't support it natively.
