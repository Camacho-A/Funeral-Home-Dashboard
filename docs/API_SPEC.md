# API Specification (Proposed — Not Implemented)

**Status: proposed structure only.** No API routes exist in the codebase yet. This document defines the route list and request/response contract Beacon's Next.js Route Handlers are expected to implement in a later, separately approved phase — nothing here should be read as already built. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the general request-handling pattern (verify session → check role → validate → call a `services/*` function scoped by `organizationId` → audit log → respond).

## Auth

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/auth/session` | Exchange a validated Wix Member session for Beacon's first-party session cookie. |
| `DELETE` | `/api/auth/session` | Log out — clears the session cookie. |

## Cases

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/cases` | List/search/filter cases (by status, stage, decedent name, owner). |
| `POST` | `/api/cases` | Create a case (New Case / First Call). |
| `GET` | `/api/cases/[caseId]` | Fetch one case's full record. |
| `PATCH` | `/api/cases/[caseId]` | Update case fields, advance/change stage, reassign owner, toggle veteran flag, etc. |
| `DELETE` | `/api/cases/[caseId]` | Soft-delete (archive) a case — never a hard delete, per [CMS_SCHEMA.md](./CMS_SCHEMA.md#cross-store-integrity). |

## Contacts

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/cases/[caseId]/contacts` | List a case's contacts. |
| `POST` | `/api/cases/[caseId]/contacts` | Add a contact. |
| `PATCH` | `/api/cases/[caseId]/contacts/[contactId]` | Update a contact. |
| `DELETE` | `/api/cases/[caseId]/contacts/[contactId]` | Remove a contact. |

## Case Tasks & Global Tasks

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/cases/[caseId]/tasks` | List a case's linked tasks. |
| `POST` | `/api/cases/[caseId]/tasks` | Quick-add a task for a case. |
| `PATCH` | `/api/cases/[caseId]/tasks/[taskId]` | Toggle/edit a case-linked task. |
| `GET` | `/api/tasks` | List the office-wide Tasks view (linked + unlinked). |
| `POST` | `/api/tasks` | Add a task (optionally linked to a case). |
| `PATCH` | `/api/tasks/[taskId]` | Toggle done / edit / reassign. |
| `DELETE` | `/api/tasks/[taskId]` | Remove a task. |

## Case Log

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/cases/[caseId]/log` | Fetch a case's note/contact log entries. |
| `POST` | `/api/cases/[caseId]/log` | Add a log entry (`type: note \| contact`). |

## Documents (backed by the Postgres/object-storage service — see ARCHITECTURE.md)

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/cases/[caseId]/documents` | List a case's documents (auto-required + uploaded). |
| `POST` | `/api/cases/[caseId]/documents` | Create a `Document` row (`PENDING`) and return a presigned upload URL. |
| `POST` | `/api/cases/[caseId]/documents/[documentId]/complete` | Mark an upload complete (`PENDING` → `ACTIVE`); writes an audit log entry. |
| `GET` | `/api/cases/[caseId]/documents/[documentId]` | Return a short-lived presigned download URL; writes an audit log entry before returning it. |
| `DELETE` | `/api/cases/[caseId]/documents/[documentId]` | Archive a document (soft — sets `status: ARCHIVED`, does not delete the underlying object). |

## Activity & Audit

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/cases/[caseId]/activity` | The auto-derived activity timeline for a case (see [BUSINESS_RULES.md](./BUSINESS_RULES.md#activity-timeline)). |
| `GET` | `/api/cases/[caseId]/audit` | Raw audit log rows for a case (compliance/admin use, distinct from the user-facing activity timeline). |

## Staff

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/staff` | List staff for assignment dropdowns (owner reassignment, task assignee). |
| `POST` | `/api/staff` | Create a `StaffProfiles` row (admin only). |
| `PATCH` | `/api/staff/[staffId]` | Update role/active status (admin only). |

## Reports

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/reports/summary` | KPI tile data (active/completed/overdue/total). |
| `GET` | `/api/reports/stage-breakdown` | Time-in-stage vs. SLA target, per stage. |
| `GET` | `/api/reports/staff-load` | Active + overdue case counts per staff member. |
| `GET` | `/api/reports/veteran-cases` | Veteran cases and VA notification status. |

## What's Deliberately Not Here

Per the current phase of work, this document does not include: Wix Data collection creation/migration scripts, Prisma migrations, or any actual Route Handler implementation. Those are a later, separately approved phase — see [ROADMAP.md](./ROADMAP.md).
