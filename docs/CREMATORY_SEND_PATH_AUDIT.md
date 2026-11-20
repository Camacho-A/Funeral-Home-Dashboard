# Crematory send-path audit (2026-11)

Question: can anything send documents or information to the crematory — or
record that the crematory has them — without passing the release gate
(`sendToCrematory.requireReleaseAfterService`) once it is enabled?

Method: every module that can send email, SMS or fax
(`sendOutlookMessage`, Resend, Twilio, fax bundles), every route under
`app/api/**/crematory*`, the cron jobs, and every write that marks paperwork
as sent.

## Paths and their status

| # | Path | Sends / records | Gate | Status |
|---|---|---|---|---|
| 1 | `POST /api/crematory/review` → `reviewCrematorySend` | builds the review | readiness incl. `released_for_cremation` | gated |
| 2 | `POST /api/crematory/send` → `sendCrematoryPackages` | **emails the package** (Outlook) | readiness checked at review AND again inside the send lock (`readyToSend`); plus `sendingEnabled` (Gus: off) | gated |
| 3 | `reconcileCrematorySend` (same route family) | resolves an uncertain SOLIS send | only for a send SOLIS already attempted (which passed #2) | not a new send |
| 4 | `POST /api/cases/[caseId]/crematory` `record_previous_send` (`sent_outside_solis`) | records the crematory **has** the paperwork — marked "Recorded as sent outside SOLIS" | **closed 2026-11:** allowed only with a valid release not on hold (approved 2026-11-20); refused while unreleased, on hold, or after the sign-off in force was corrected (`releaseGateRefusal`) | gated |
| 5 | same, `correct_previous_send` → `sent_outside_solis` (admin) | same | **closed 2026-11** | gated |
| 6 | `PATCH /api/cases/[caseId]` checking "Permit / Authorization sent to crematory" | records the crematory has the paperwork; moves the workflow | **closed 2026-11:** checking (not unchecking) refused while unreleased / on hold — on the server, and in the mock path. Who may: Admin, Manager, Funeral Director at Gus (approved 2026-11-20); Admin only at Manors | gated |
| 7 | Automatic completion of those steps (`crematorySentChecklist.ts`) | after Outlook accepts a send | runs only after #2 | follows #2 |
| 8 | Fax bundles (`/api/fax-bundles/[bundleId]/send`) | faxes **Manatee death-certificate applications** to Vital Statistics destinations | document type fixed to the DC application; destinations are Vital Statistics; Gus fax off | not a crematory path |
| 9 | Signature requests (`signature.request`) | emails a signing link to a signer | Gus: e-signatures disabled (pinned) | not reachable for Gus |
| 10 | Family Portal messages / invitations | family only | Gus: portal disabled (pinned) | not reachable for Gus |
| 11 | Notifications (email/SMS channels), cron jobs (reminders, digests, SLA alerts, bill reminders) | staff / family notices; no case documents | no crematory recipient | not a crematory path |
| 12 | Document download / print | a person can carry a file anywhere | outside SOLIS | **residual** — procedural, see below |

## Residual risk (not closable in software)

Staff can download a permit or the package and email/fax it from outside
SOLIS. SOLIS cannot stop that. What SOLIS does: (a) the release status and any
hold are prominent on the case; (b) recording such a send (#4–#6) is refused
while unreleased or on hold; (c) a hold placed after paperwork went out says
plainly that the crematory must be contacted — a hold never recalls anything.

## Tests

`services/crematory/crematoryReleaseGate.test.ts` (gate on in test: unreleased,
on hold, pending reauthorization all block; reauthorized unblocks; "sent
outside SOLIS" refused, "not previously sent" allowed),
`domain/servicePreparation/releaseHolds.test.ts › releaseGateRefusal` and
`› the crematory gate refuses while a correction is pending` (a correction
of an active release awaiting independent confirmation blocks every gated
path, like a hold),
`domain/crematory/crematoryReadiness.test.ts › release gate`.
