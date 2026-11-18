# Service preparation (Gus Phase 5B, 2026-11)

Preparation for services held **before cremation** — Cremation with Viewing,
Cremation with Final Goodbye, and (provisionally) Mass. Code:
`domain/servicePreparation/`, `components/case/ServiceReadinessCard.tsx`.

## What exists (code only, no Wix change)

- **Reusable groups** (`preparationGroups.ts`): service date confirmed with the
  family; crematory hold; embalming + written permission; clothing; casket;
  casket spray; prayer cards (language, image, family proof, printing);
  register book; crucifix; clergy; church; transportation and staff; day of
  the service. Embalming, clothing and casket apply only when the family's
  choice switches them on. Casket spray, prayer cards, register book,
  crucifix and clergy are optional: a Requested / Not requested choice, and
  undecided shows as a decision to make.
- **Draft service definitions** (`serviceDefinitions.ts`): Viewing, Final
  Goodbye, Mass. All `status: 'draft'` and shown as "Draft — awaiting funeral
  director approval". Mass uses the provisional code `CREMATION_WITH_MASS`,
  which is not in `SERVICE_TYPE_CODES`, the service catalog or any workflow.
  Cremation waits for a Mass only when the body is present (undecided until
  chosen).
- **Deadlines** (`deadlines.ts`): operational targets relative to the service
  start, never stored, so a reschedule moves them. Defaults: crematory
  notification, casket order and church coordination 72–48 h; clergy and
  casket spray 48–24 h; prayer cards 48 h. Overridable per call. A service
  booked after a target's latest point shows "Due now — short notice" and is
  flagged for review. Anything open inside the last 24 hours is urgent.
- **Readiness** (`readiness.ts`): completed, awaiting confirmation, needing
  reconfirmation, upcoming deadlines, urgent/overdue, open before the family
  arrives, decisions to make. It never reads the workflow stage, so it works
  while EDRS or any earlier stage is open, and returns nothing that completes
  a workflow or legal step.
- **Reconfirmation**: a date-dependent confirmation records the service
  start it was for. After a reschedule it shows "Confirm again for the new
  date"; the earlier confirmation is kept, and nothing is duplicated (items
  are keyed by stable `prep.` ids).
- **Change rules** (`preparationUpdates.ts`), for the future route: only the
  service's own ids/choices/details; never a `cremation.` step; a required
  item cannot be Not requested; a date-dependent confirmation needs a
  scheduled service.
- **Release for cremation** (`releaseForCremation.ts`): requirements are
  crematory notified, hold confirmed for the current date, service completed,
  authorized approver. **Disabled** (see below).
- **Appointment types** `final.goodbye` and `funeral.mass` (Viewing already
  existed). Offered and accepted only when the organization profile has
  `servicePreparation` (Gus); Manors is never offered them and the server
  refuses them.
- **Service Readiness card** on the case Overview, Gus only, for cases whose
  service has a preparation. Interactive since Phase 5C: family choices,
  details, item statuses, notes and linked documents.

The Direct Cremation template, the Viewing and Final Goodbye templates (still
the cremation foundation unchanged), Send to Crematory, prices, the catalog
and every existing case are unchanged.

## Storage (Phase 5C) — Wix change needs approval (not made)

**Code (done):** `servicePreparation` on the case (`types/case.ts`), read
leniently by `lib/wixCaseMapper.ts` (`domain/servicePreparation/recordParsing.ts`),
written only by `services/servicePreparationService.ts` through
`GET/POST /api/cases/[caseId]/service-preparation`. Not in the generic case
PATCH allowlist, so nothing else can write it.

**Verified against live Wix (read-only, 2026-11-13):** collection `cases`,
revision 32, 64 declared fields, permissions ADMIN for everything. The
existing server-written JSON records — `crematory`, `checklistCompletions`,
`slaEvents`, and `revision` itself — are **not declared** fields: Wix stores
them on the rows anyway. `checklistState` is declared as `OBJECT`.
`servicePreparation` is absent.

So Wix would accept `servicePreparation` without any schema change. That is
why saving is switched off in code for live Wix
(`SERVICE_PREPARATION_WIX_FIELD_ADDED = false` in
`services/servicePreparationStorage.ts`): until approval, a Wix-mode save is
refused before anything is sent to Wix, and reads simply find no
preparation.

**Done 2026-11-17 (Phase 5D, approved):** the field below was added with `create-field` — `cases` revision 32 → 33, 64 → 65 fields, nothing else changed (permissions, indexes, settings identical; the 19 existing case rows untouched). Live saving is still switched off (`services/servicePreparationStorage.ts`).

Field (additive; existing rows read it as absent):

| Field | Type | Required | Mutable |
|---|---|---|---|
| `servicePreparation` | Object (`OBJECT`), nullable | Optional | Server-written only — a whole record decided from the row as it is now, under the case revision check |

Declaring it is optional for Wix but recommended: it shows in the CMS with
its type, like `checklistState`. Steps, once approved:

1. Read `cases` and stop unless revision and field count are what was last
   seen and `servicePreparation` is still absent.
2. `POST /wix-data/v2/collections/create-field` with
   `{ dataCollectionId: 'cases', field: { key: 'servicePreparation', displayName: 'servicePreparation', type: 'OBJECT' } }`
   — once, no retry of the write.
3. Read again: the field is present, no field lost, permissions unchanged.
   No row is written.
4. Set `SERVICE_PREPARATION_WIX_FIELD_ADDED = true` and release that commit.

(Skipping steps 1–3 and only doing step 4 also works, following the
`crematory` precedent; the field then stays undeclared.)

**Manors:** unaffected. Manors never has service preparation (profile flag
off), its cases never get the field, the generic PATCH cannot write it, and
an absent field maps to nothing.

**Tenant isolation:** every read and write is scoped to the caller's
organization (`loadCaseOnServer` / `loadCaseRow` filter on `organizationId`,
and the conditional write is conditioned on it too). Viewing needs
`case.read`; changing needs `case.update`.

**Concurrent staff:** each save names what it was based on (the `at` of the
item, choice or detail being changed). A change to an entry someone else
changed since is refused with 409 and the latest is shown. Changes to other
entries merge: the server re-reads and re-decides under the case revision
check (`updateCaseWithRetry`), so no one's save is lost.

**History (Phase 5E):** every change appends one entry to the record's own
`history` — target, entry before and after, staff id and name, server time,
and a server-generated event id — in the SAME revision-checked write as the
change, so a change can never be saved without its entry. History is never
trimmed or repaired; if a stored record or its history cannot be read, saves
are refused rather than writing over it. The Activity event
(`service_preparation.updated`) is written afterwards with the event id as
its correlationId — one event per change. If it fails, the failure is
logged and the history entry (shown on the card as "Preparation history")
still has the change. When Wix's answer to a save is unclear, the case is
read back and the event id decides "saved" or "not saved"; the write is
never retried blindly.

**Size:** a change that would take the record (with its history) past
128 KB is refused with nothing saved (HTTP 413) — never by deleting
history. A typical service uses a small fraction of that (each entry is a
few hundred bytes; the Wix item limit is 512 KB for the whole case row).

## Release permission — gap

SOLIS cannot enforce "an authorized licensed funeral director" yet:

- Roles are assigned by an administrator. A `funeralDirector` role exists,
  but holding it is not proof of a license, and no staff record stores a
  license number or expiry.
- Live permissions come from stored `rolePermissions` rows; a new
  `service.releaseForCremation` permission would need RBAC writes in Wix.
- The release would have nowhere to be saved until `servicePreparation` is
  approved.

So the release button is shown disabled with the reason, never as an
approval that proves nothing. Needed decisions: which staff may release; whether
SOLIS should record their license (number, expiry) on the staff profile;
then a new permission granted to that role only.

The release is **in addition** to the legal requirements, never instead of
them. Authorization, permit, medical examiner approval, identification and
the 48-hour wait stay where they are (the cremation workflow and Send to
Crematory). Making Send to Crematory wait for the release is a later,
separately approved change; today's sending behavior is untouched.

## Open decisions (funeral director)

- Is Mass a service of its own or an optional part of another? Body present,
  cremated remains, or both?
- Is embalming required for every public Viewing? Rental or purchased casket?
- What exactly is a Final Goodbye (attendance, length, place, presentation)?
- Who may release remains for cremation after a service?
- Are the default deadline targets right for Gus's vendors and parishes?
