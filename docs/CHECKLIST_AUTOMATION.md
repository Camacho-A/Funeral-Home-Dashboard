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
  often the event is retried or delivered.
- Never over a staff decision. When staff change an automatable item, the
  case records `{ by: 'staff' }` for it, and automation leaves it alone
  from then on.
- The tick and its provenance (`Case.checklistAutomation`, keyed like
  `checklistState`) are written together, field-scoped and conditioned on
  the case revision. The field is server-written only.
- Stage progression is unchanged: the existing `reconcileCaseWorkflow` runs
  afterwards and advances only when every requirement of a stage is met.
- Historical cases are not reprocessed: nothing runs on deploy, and neither
  the historical import nor the "recalculate workflow" repair completes items.

## Audit trail and display

Each completion records one `case.checklist.completed_automatically` activity
event. It is attributed to SOLIS (system-generated, no staff actor), names the
item and its evidence, and carries the item key and source in metadata. The
checklist shows a quiet "Completed automatically" beside the item. It remains
an ordinary checkbox that staff can correct.

## Would need new integrations

- Sending the payment receipt from SOLIS (email), which would let "Payment
  receipt sent" complete on a confirmed send.
- An outbound fax or e-delivery record for the permit and authorization to
  the crematory.
- An EDRS integration for the death-certificate items.
- A Vital Statistics form receipt mapped to its own checklist item. Today,
  the received form is preserved as a document but no item stands for it.
