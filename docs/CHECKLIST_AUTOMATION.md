# Automatic checklist completion (Manors)

Introduced 2026-10. Staff should not have to do something in SOLIS and then
tick a box saying they did it. Where SOLIS can **verify** the work from its
own records, the event that proves it completes the checklist item.

Enabled per organization (`features.automaticChecklistCompletion`): Manors
only. Every other organization, including Gus SOLIS, behaves exactly as
before.

## What completes automatically

| Checklist item | Completed when | Code |
|---|---|---|
| Payment collected | A verified payment brings the case's balance to zero (Clover webhook/poll, or a recorded manual payment). A deposit or partial payment does not; a failed or pending payment never does. | `services/paymentWorkflow.ts` |
| Jotform application completed | The case's Arrangement Form submission is received and linked (webhook, manual link, review, import-submission, form-created case). A sent link is not enough. | `services/automaticChecklistCompletion.ts` |
| EDRS submitted & sent to doctor; Attestation Received / Hard Saved; Permit / Authorization sent to crematory | Staff record the event in SLA details (`docs/SLA_TRACKING.md`). That is the explicit, audited confirmation SOLIS needs for external work it cannot verify itself. | `services/slaService.ts` |

Already derived from their own records (unchanged):

- **First Call items** (name, dates, weight, certifier, family contact): done
  when the case information exists.
- **Family picked up ashes**: done from the authorized release record
  (Released To + Released Date). Expected Pickup and Date Received are
  never treated as release.
- **Ashes picked up (Tue/Fri)**: staff tick it (or use Mark Received); the
  pickup appointment follows the tick.

## What stays manual, and why

| Item | Why |
|---|---|
| Payment receipt sent | SOLIS generates the receipt but has no way to send it, and generating is not sending. |
| EDRS submitted & sent to doctor; Cause of death entered; Attestation Received / Hard Saved; Medical Examiner verification items | Done in the state EDRS system; SOLIS has no connection to it. |
| Permit sent to crematory; Authorization of release sent to crematory | Sent outside SOLIS (fax). An uploaded document is not proof it was sent or accepted. |
| DC application filled out; Sent day before ashes arrive | No generated DC application or send record in SOLIS. |
| Tag/name/cert cross-checked; Labels made; Transferred to urn | Physical work requiring human confirmation. |
| Family contacted — ashes ready for pickup | Contact happens by phone; a Case Log entry is free text, not verifiable evidence. |

## Rules (`domain/workflow/checklistAutomation.ts`)

- Never on an archived case.
- Never for an item that is already done: no change and no event, however
  often the event is retried. The original completion source is kept.
- Never over a staff decision. Once staff complete or reopen an item, the
  automation leaves it alone.
- The tick and its record are written together, field-scoped and
  conditioned on the case revision. Records are server-written only.
- Stage progression is unchanged: the existing `reconcileCaseWorkflow`
  advances a stage only when all of its requirements are met.
- Historical cases are not reprocessed.

## Completion attribution

Every checklist decision made from 2026-10 onward leaves a
`ChecklistCompletionRecord` in `Case.checklistCompletions`, keyed like
`checklistState`. A record holds:

- `done`
- `method` (automatic or manual)
- `source`: Payment confirmed / Document generated / Verified document
  received / Workflow event completed / Staff confirmation
- `eventType` and `eventId` (the related payment, submission or event)
- `at`
- `actorId`: the staff identity for a manual decision, `solis-automation`
  for an automatic one

The checklist shows a quiet note beside each done item:

- **Completed automatically**: an automatic record, or an item derived from
  case information or the release record.
- **Completed manually**: a staff decision.
- **Completion source unavailable**: done before records existed. Nothing
  is inferred.

The ⓘ button shows why, when, by whom (a staff name or SOLIS Automation), and
the related record. Each automatic completion also records one
`case.checklist.completed_automatically` activity event. Manual changes
keep their existing `case.updated` audit entry.

## Would need new integrations

- Sending the payment receipt from SOLIS (email), which would let "Payment
  receipt sent" complete on a confirmed send.
- An outbound fax or e-delivery record for the permit and authorization to
  the crematory.
- An EDRS integration for the death-certificate items.
- A Vital Statistics form receipt mapped to its own checklist item. Today,
  the received form is preserved as a document but no item stands for it.
