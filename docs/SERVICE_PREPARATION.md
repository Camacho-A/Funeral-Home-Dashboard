# Service preparation (Gus Phase 5B, 2026-11)

Preparation for services held **before cremation** — Cremation with Viewing,
Cremation with Final Goodbye, and (provisionally) Mass. Code:
`domain/servicePreparation/`, `components/case/ServiceReadinessCard.tsx`.

## What exists now (code only, no Wix change)

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
  service has a preparation. Read-only.

The Direct Cremation template, the Viewing and Final Goodbye templates (still
the cremation foundation unchanged), Send to Crematory, prices, the catalog
and every existing case are unchanged.

## Proposed Wix change — needs approval (not made)

One new optional field on the live `cases` collection, added with
`create-field` (additive; existing rows read it as absent):

| Field | Type | Required | Mutable |
|---|---|---|---|
| `servicePreparation` | Object (JSON), nullable | Optional | Server-written only, merged key by key like `crematory` — never accepted from the generic case PATCH |

Shape (`ServicePreparationRecord` in `domain/servicePreparation/types.ts`):

```json
{
  "definitionKey": "prep.viewing",
  "definitionVersion": 1,
  "serviceAppointmentId": "<appointments.beaconAppointmentId>",
  "choices": { "casket": "rental", "prayerCards": "requested" },
  "details": { "prayerCards.language": "spanish", "clergy.name": "…" },
  "items": {
    "prep.crematory.hold_confirmed": {
      "status": "confirmed",
      "forServiceStartAt": "2026-12-10T15:00:00.000Z",
      "note": null,
      "at": "2026-12-02T12:00:00.000Z",
      "by": "<identity id>",
      "byName": "…"
    }
  },
  "release": null
}
```

Latest state only; every change also goes to Activity (who, when, before and
after), the same split as `checklistCompletions`. Supporting documents stay
in the existing Documents tab (`caseDocuments`); no new collection.

Once approved, the remaining work is: the mapper read/write, a
`POST /api/cases/[caseId]/service-preparation` route using
`applyPreparationChange` (case.update, same organization, case revision
check), Activity events, and turning on the card's controls.

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
