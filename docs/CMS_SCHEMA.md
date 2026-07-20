# CMS Schema

This document defines the Wix Data collections that back Beacon's operational data, and the Postgres schema that backs the compliance/document service. See [ARCHITECTURE.md](./ARCHITECTURE.md) for why the two are split.

Every collection and table below carries an `organizationId` field, even though Version 1 has exactly one organization. No query is ever written without filtering on it. This is the mechanism that lets Beacon become multi-tenant later without a schema change — see [DECISIONS.md](./DECISIONS.md).

## Wix Data Collections

### `Cases`

The core record for one decedent's case. Field list is drawn directly from the raw case data and derived fields used throughout `design/Beacon.dc.html`.

| Field | Type | Notes |
|---|---|---|
| `_id` | text (system) | Wix Data record id |
| `organizationId` | text | tenant scope, required on every query |
| `caseNumber` | text | human-facing case #, e.g. "1042" |
| `decedentFirstName` / `decedentLastName` | text | |
| `dateOfBirth` | date | |
| `dateOfDeath` | date | |
| `timeOfDeath` | text | 24hr, e.g. "06:12" |
| `placeOfDeath` | text | name, address & phone of the facility |
| `weight` | text | e.g. "178 lb"; drives the >200lb "notify crematory" flag |
| `dispositionType` | text (enum) | `cremation` \| `burial` \| `other` |
| `status` | text (enum) | raw stage index, see [BUSINESS_RULES.md](./BUSINESS_RULES.md) for the 7-stage model |
| `assignedStaffId` | text | ref → `StaffProfiles._id` |
| `assignedStaffName` | text | denormalized for list display |
| `nextOfKinName` / `nextOfKinPhone` | text | primary next-of-kin quick-reference (full contact detail lives in `CaseContacts`) |
| `paymentStatus` | text (enum) | `awaiting_payment` \| `paid_in_full` |
| `isVeteran` | boolean | armed-forces flag |
| `vaStepsState` | object | `{ [stepIndex]: boolean }` — VA notification sub-workflow progress |
| `vaPublishChoice` | text (enum, nullable) | `publish` \| `private` |
| `checklistState` | object | `{ [itemIndex]: boolean }` — overrides the stage default |
| `fieldValues` | object | `{ [itemIndex]: string }` — First Call & Payment data-entry answers |
| `notes` | text | free text |
| `isDeleted` | boolean | soft delete only — see cross-store integrity note below |
| `createdBy` | text | staff member who opened the case |
| `_createdDate` / `_updatedDate` | date (system) | |

### `CaseContacts`

Next-of-kin and other case contacts.

| Field | Type | Notes |
|---|---|---|
| `organizationId` | text | |
| `caseId` | text | ref → `Cases._id` |
| `fullName` | text | |
| `relationship` | text | |
| `phone` / `email` / `address` | text | |
| `isPrimaryContact` | boolean | |
| `isAuthorizedAgent` | boolean | authorized to make disposition decisions |
| `authorizationNotes` | text | |

### `CaseTasks`

The office-wide task list (Tasks screen), optionally linked to a case.

| Field | Type | Notes |
|---|---|---|
| `organizationId` | text | |
| `caseId` | text (nullable) | ref → `Cases._id`, null = not linked to a case |
| `text` | text | |
| `assigneeStaffId` | text | ref → `StaffProfiles._id` |
| `isDone` | boolean | |
| `createdAt` | date | |

### `StaffProfiles`

Staff identity/role metadata, kept separate from Wix Members (which owns login identity only).

| Field | Type | Notes |
|---|---|---|
| `organizationId` | text | |
| `memberId` | text | ref → Wix Member `_id`, 1:1 |
| `displayName` | text | e.g. "Dana", "Chris", "Priya" |
| `role` | text (enum) | `admin` \| `funeral_director` \| `staff` — see [USER_ROLES.md](./USER_ROLES.md) |
| `email` | text | |
| `isActive` | boolean | |

### `CaseLogEntries`

Free-form case notes and structured "who did you call" contact log entries (Case Log panel on the Case Detail screen).

| Field | Type | Notes |
|---|---|---|
| `organizationId` | text | |
| `caseId` | text | ref → `Cases._id` |
| `type` | text (enum) | `note` \| `contact` |
| `text` | text | populated when `type = note` |
| `contactedWho` / `contactedSpoke` / `contactSummary` | text | populated when `type = contact` — who was contacted, who was spoken with, and a summary |
| `author` | text | staff display name |
| `createdAt` | date | |

## Postgres Schema (Compliance/Document Service)

```prisma
enum DocumentType { DEATH_CERTIFICATE BURIAL_CREMATION_PERMIT AUTHORIZATION_FORM SIGNED_CONTRACT OTHER }
enum DocumentStatus { PENDING ACTIVE SUPERSEDED ARCHIVED }

model Document {
  id             String         @id @default(cuid())
  organizationId String
  caseId         String         // Wix Cases._id — NOT a DB foreign key, separate system
  documentType   DocumentType
  fileKey        String
  fileName       String
  mimeType       String
  fileSizeBytes  Int
  version        Int            @default(1)
  status         DocumentStatus @default(ACTIVE)
  uploadedBy     String
  uploadedByName String
  uploadedAt     DateTime       @default(now())
  supersedesId   String?
  @@index([organizationId, caseId])
  @@index([organizationId, documentType])
}

model AuditLog {
  id             String   @id @default(cuid())
  organizationId String
  entityType     String   // case | document | contact | task
  entityId       String   // Wix _id or Postgres id depending on entityType
  action         String
  actorId        String
  actorRole      String
  timestamp      DateTime @default(now())
  metadata       Json?
  @@index([organizationId, entityType, entityId])
  @@index([organizationId, timestamp])
}
```

### Cross-Store Integrity

`Document.caseId` and `AuditLog.entityId` are string pointers into Wix Data — not enforceable foreign keys, since Prisma has no visibility into a separate system. This is handled by policy rather than a database constraint: **Cases are never hard-deleted**, only soft-deleted (`Cases.isDeleted = true`), specifically so that compliance documents and audit rows tied to a `caseId` remain retrievable even after a case is archived. Every route that touches Postgres for a given case validates first, in Wix, that the case exists and belongs to the requesting session's organization; if that lookup fails while Postgres rows for that `caseId` still exist, the UI surfaces an "archived / unavailable" state rather than silently losing access to a regulated record.
