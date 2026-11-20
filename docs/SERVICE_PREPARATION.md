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

## Storage (Phase 5C–5E)

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

## Gus's confirmed rules (Phase 5F, 2026-11)

**Cremation with Viewing** (`VIEWING_PREPARATION` v2, approved): embalming is
mandatory for every formal Viewing — no waiver, no embalming choice, the
steps can't be marked Not requested. The crematory embalms, dresses and
caskets; Gus gets the embalming authorization at arrangements and sends it
to the crematory. Always tracked: embalming authorization signed / sent /
embalming done; family clothing received / delivered to the crematory /
dressing done; casket selected / ordered / delivered to the crematory /
casketing done; the scheduled Viewing; the crematory told about it and its
hold confirmed. Casket spray, prayer cards, register book and crucifix stay
optional.

**Cremation with Final Goodbye** (`FINAL_GOODBYE_PREPARATION` v2, approved):
Miami chapel reserved; attendees confirmed (the attendee count is refused
above 6); remains in the cardboard cremation container covered with a white
sheet; optional face-only viewing; optional priest or pastor. No embalming,
dressing or casket; no prayer cards, register book or crucifix. A Final
Goodbye booked longer than 60 minutes is flagged (provisional limit), not
blocked.

**Mass** stays a draft and is not offered anywhere.

## Release for cremation (Phase 5F) — rules built, NOT active

`domain/servicePreparation/releaseForCremation.ts`, enforced on the server by
`services/cremationReleaseService.ts`. Telling the crematory about the
service is not a release and not a prerequisite. Every one of these must be
met — none unlocks release alone (a confirmed permit included):

1. the scheduled service marked **completed**;
2. cremation authorization (arrangement form) step done;
3. EDRS submitted, cause of death and attestation done;
4. **medical examiner cremation approval recorded** (Phase 5G) — a valid
   approval in the case's `crematory.medicalExaminerApproval`: confirmed in
   EDRS, approval date (not in the future, not before death), EDRS/ME
   reference, evidence (a document on the case and/or the verification
   source), who recorded it and when. Never inferred from the permit, EDRS
   ticks or the ME jurisdiction flag;
5. state burial-transit permit confirmed on the case;
6. at least 48 hours since death (in the funeral home's time zone; a missing
   time counts from the end of that day, a missing date blocks);
7. identification checked on the remains (service day);
8. Viewing only: embalming authorization signed;
9. the approver is an **authorized Funeral Director** (Phase 5F.1, Gus
   policy): the Funeral Director role (`cremationReleaseApproverRoleKeys`;
   Gus: `funeralDirector` only; Manors and the platform default: nobody),
   or — for anyone else, an administrator included — an explicit
   `StaffProfile.funeralDirectorAuthorization` granted by someone else
   (never self-granted). An Administrator role alone never qualifies; and
10. the approver holds a **verified** funeral director license
    (`domain/staff/funeralDirectorLicense.ts`): number, state and type on
    file; status active; not expired; verified by someone else (who, when,
    how, where); active profile in the same organization. A "Funeral
    Director" role or display role is never enough on its own.
    Re-verification interval: `funeralDirectorLicenseReverifyDays` —
    **pending decision** (null for Gus: age not enforced, shown as pending;
    365 days is only proposed, `PROPOSED_LICENSE_REVERIFY_DAYS`).

`approveCremationRelease` runs every check and then refuses with "not
active yet" (`RELEASE_FOR_CREMATION_AVAILABLE = false`). Nothing is written
or sent; Send to Crematory is unchanged. `buildCremationReleaseRecord`
defines what a release will record: case, organization, service appointment,
time, the approving director (identity, staff profile, name, role, license
number, state, expiry) and every satisfied prerequisite.

### Phase 5G — implemented in the sandbox

**Medical examiner cremation approval** — recorded from the Service
Readiness card (`POST /api/cases/[caseId]/medical-examiner-approval`,
case.update) by `services/medicalExaminerApprovalService.ts`, inside the
case's EXISTING `crematory` record (`medicalExaminerApproval` +
append-only `medicalExaminerApprovalHistory`), through the revision-checked,
key-merged case write — so the permit and every other crematory key are
untouched. A correction needs a reason; every recording stays in the
history and is an Activity event (`case.medical_examiner_approval_recorded`).
No new Wix field: `crematory` already exists on live rows (undeclared,
written by Send to Crematory in Manors Production). Live writes are OFF
(`MEDICAL_EXAMINER_APPROVAL_LIVE_SAVING = false`).

**Funeral director credentials** — Settings › Funeral Director Credentials
(Gus only, `organization.manage`), `GET/POST /api/settings/funeral-director-
credentials`, `services/funeralDirectorCredentialService.ts`. Per staff
profile: license number, state, type, status, expiry; verification (by,
when, method, source); separate Funeral Director authorization; revision;
append-only history (also an Activity event,
`staff.funeral_director_credential_changed`). Nobody enters, verifies,
authorizes or de-authorizes themselves. Changing license details clears the
verification. Gus's re-verification policy: 365 days
(`funeralDirectorLicenseReverifyDays`, configurable). Managing credentials
never permits release: release still needs the Funeral Director role or
authorization, a verified license and every case prerequisite — and is not
active.

### Live credential storage (Phase 5H/5H.1)

The `funeralDirectorCredentials` collection was created on 2026-11-18 (approved
design; see `docs/WIX_DATA_SCHEMA.md`, Collection 99): ADMIN-only, a regular
`(organizationId, staffProfileId)` index, deterministic `_id`
`fdc.{organizationId}.{staffProfileId}` for uniqueness (Wix unique indexes are
single-field only, so the originally proposed compound unique index was not
possible), conditional patches on `revision` for concurrency, credentials and
history saved in one patch. The adapter is `services/funeralDirectorCredentialStore.ts`;
live reads and writes happen only in a deployment that sets
`SOLIS_FD_CREDENTIALS_STORAGE=wix` (`services/funeralDirectorCredentialSwitch.ts`);
no existing deployment does. No records exist.

Record id (Phase 5I): "." is the separator. Wix documents only the
128-character limit; ":" has no live precedent on this site, while "." is in
live ids today (`rolePermissions`, `notifications`, …).

Self-privilege (Phase 5I): nobody can assign themselves a release role
(`app/api/rbac/assignments/route.ts`, Gus only — organizations without
release roles are unaffected), enter/verify their own license, or grant
themselves Funeral Director authorization. Deployment variables:
`docs/GUS_DEPLOYMENT_ENVIRONMENT.md`.

### Recording the release (Phase 5K) — built, NOT active

`POST /api/cases/[caseId]/cremation-release { organizationId, confirm: true }`
→ `services/cremationReleaseService.ts › approveCremationRelease`.

- Refused (423) unless BOTH `RELEASE_FOR_CREMATION_AVAILABLE` and
  preparation saving on this site (`SERVICE_PREPARATION_WIX_FIELD_ADDED`
  on Wix) are on. Both are off. The card's button stays disabled.
- The approver, time and every requirement come from the server (session,
  case, the approver's own credential record). The body carries only the
  confirmation.
- Decided again from the case as it is at write time; a requirement that
  stopped being met in between refuses the release.
- Saved as `servicePreparation.release` together with a `release` history
  entry, in ONE revision-checked case write. The stored release keeps the
  approver, why they count as a Funeral Director (role or authorization),
  their license (number, state, expiry, who verified it and when), the
  service appointment and every satisfied requirement.
- Once and only once: a second release is refused, and preparation becomes
  read-only. There is no "undo" — whether and how a release may be
  reversed is an open decision (below).
- An unclear Wix answer is settled by reading the case back (the event id
  decides); never a blind retry.
- One `case.released_for_cremation` Activity event, with the same id.
- Sends nothing. The checklist, stage, crematory record and Send to
  Crematory are not touched.

### Still needed before release can be activated

- A Gus Wix-connected deployment and approval to set
  `SOLIS_FD_CREDENTIALS_STORAGE=wix` on it.
- Approval to write ME approvals to live case rows
  (`MEDICAL_EXAMINER_APPROVAL_LIVE_SAVING`).
- Approval to save preparation on live Wix
  (`SERVICE_PREPARATION_WIX_FIELD_ADDED`), then
  `RELEASE_FOR_CREMATION_AVAILABLE`.
- Send to Crematory refusing a Viewing/Final Goodbye case until released —
  a separate, approved change.

## Medical examiner findings (Phase 5F.1, read-only review)

What SOLIS records today:

- `Case.isMedicalExaminerCase` — a yes/no classification that the ME has
  jurisdiction (the ME holds the decedent and certifies cause of death). It
  is not an approval.
- Manors only (profile `medicalExaminerStages`): on an ME case the EDRS
  stage shows three verification items — "Medical Examiner EDRS entry
  verified", "Medical Examiner cause of death verified", "Required ME
  information confirmed". Gus has no ME variant.
- Every cremation workflow: EDRS submitted, cause of death entered, and
  attestation / hard-save for state approval — checklist ticks, no date or
  reference.
- The state cremation permit (`cremation_form.state_permit` document) and
  its confirmation on the case (`crematory.permitVerification`).
- Send to Crematory requires the permit and the EDRS (or ME verification)
  steps; it has no separate ME-approval requirement.

Nowhere does SOLIS record a medical examiner **cremation approval**
(Florida §406.11(1)(c): the ME must determine the cause of death of every
body to be cremated; approvals are requested through EDRS). It cannot be
verified from existing records: the checklist ticks carry no approval, and
whether a Florida burial-transit permit can only be issued after the ME's
cremation approval was NOT confirmed (no source found that says so) — so
the permit is not treated as proof of it.

Options (each needs approval; none changes a legal safeguard until chosen):

1. **Staff attestation in the existing `crematory` case record** (no new
   Wix field — it is already a server-written record): "ME cremation
   approval confirmed in EDRS", with the approval date, EDRS/ME reference,
   who recorded it and when. Recommended: explicit, audited, no schema
   change.
2. **A new checklist step in Gus's EDRS stage** ("ME cremation approval
   received") — a new workflow template version through Gus's approval
   rule; a tick only, no reference.
3. **Treat the confirmed state permit as the evidence** — only if Gus's
   funeral director (or counsel) confirms that in Florida the permit cannot
   be issued without the ME's cremation approval.

Until one is chosen, the release prerequisite "Medical examiner cremation
approval recorded" is never met, for every case — ME-jurisdiction cases
included. That is the safe default: no case can be released on an
unrecorded approval.

## Open decisions (funeral director)

- Mass: its own service or part of another? Body present, cremated remains,
  or both? (Still a draft.)
- Viewing: what happens when the family brings no clothing? Rental or
  purchased casket, and who supplies it?
- Final Goodbye: is 60 minutes the confirmed maximum?
- License re-verification: 365 days set as Gus's internal policy
  (configurable) — confirm.
- Medical examiner cremation approval: decided (Phase 5G) — option 1,
  recorded staff attestation in the existing `crematory` record.
- Release: who at Gus may administer credentials (today: any administrator
  with organization.manage, never for themselves)?
- Prayer cards, register book, crucifix for a Final Goodbye: offered or not?
- Are the default deadline targets right for Gus's vendors and parishes?
- Reversing a release (Phase 5K): may a release be withdrawn (e.g. the
  family asks to wait), by whom, and does it need a reason? Not built; a
  release is final in SOLIS until decided.

