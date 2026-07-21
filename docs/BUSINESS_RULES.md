# Business Rules

This document is a faithful extraction of the domain logic embedded in `design/Beacon.dc.html`'s `Component` script (`STAGES`, `CHECKLIST_BY_STAGE`, `DEFAULT_SLA_TARGET`, `VA_STEPS`, and the `buildCase()`/`getChecklist()` functions). That script is the current specification for how a case actually moves through the funeral home's process — this document exists so the rules survive independent of the original prototype, and so they can be reviewed and corrected by the client before being encoded in application code. **Nothing here should be treated as final until the client confirms it** — it is a transcription of what the design implies, not a requirements document the client wrote directly.

## The Case Lifecycle — 7 Stages

The design tracks 8 *raw* internal stage indices (0–7), but always displays 7 stages, because "First Call" and "Payment" are two raw stages that are always handled on the same phone call and are shown to staff as a single combined stage:

1. **First Call & Payment** *(raw stages 0 and 1, merged)*
2. **Jotform Application**
3. **EDRS & Doctor / Cause of Death**
4. **Permit & Authorization Sent to Crematory**
5. **DC Application Sent**
6. **Ready for Pickup / Contact Family**
7. **Completed**

A case only reaches "Completed" once ashes have actually been picked up by the family — if a case is nominally in the last raw stage but ashes haven't been confirmed picked up, it displays as the prior stage instead. Stages cannot be skipped; a case advances one stage at a time, either by an employee completing the stage's checklist or via the dashboard's bulk "Advance to next stage" action.

## Per-Stage Checklist

Each stage has a fixed, ordered checklist of required steps. Items are locked in order — an item cannot be checked (or, for First Call & Payment, cannot be considered done) until the item before it is done. The default state is "all but the last item done," so the final, most consequential action in a stage always requires an explicit, deliberate check.

| Stage | Required steps |
|---|---|
| **First Call & Payment** | Name of deceased · Place of death (name, address & phone) · Date of birth · Weight · Date of death · Time of death · Hospice/physician who will sign the death certificate (name & phone) · Family contact (name, phone, email) · Cardholder name, card number, expiration, CVV & billing zip · Credit card payment collected by phone · Payment receipt sent (confirms cleared to dispatch) |
| **Jotform Application** | Jotform application completed |
| **EDRS & Doctor / Cause of Death** | EDRS submitted & sent to doctor · Cause of death entered · Hardsave for state approval if not an online doctor |
| **Permit & Authorization Sent to Crematory** | Permit sent to crematory · Authorization of release sent to crematory |
| **DC Application Sent** | DC application filled out · Sent the day before ashes arrive |
| **Ready for Pickup / Contact Family** | Ashes picked up (scheduled Tue/Fri) · Tag photo taken · Tag/name/certificate cross-checked · Labels made · Transferred to urn · Family contacted — ashes ready for pickup |
| **Completed** | Family picked up ashes |

**First Call & Payment is special**: its items are not checkboxes an employee clicks — each item is "done" only once the corresponding piece of information has actually been entered into the case (name, DOB, weight, card details, etc.). This is deliberate: the stage can't be marked complete by clicking through it, only by actually capturing the information. Every other stage's checklist items are plain, employee-toggled checkboxes.

A case's checklist can also be viewed **read-only for a past stage** — clicking an earlier step in the stage stepper shows what was required and done at that point in time, without allowing edits, with a "back to current stage" affordance to return.

## SLA Targets

Each stage (except "Completed," which has no target since it's the terminal state) has a target number of days a case should spend there before it's considered overdue:

| Stage | Target |
|---|---|
| First Call & Payment | same day (0.25 days) |
| Jotform Application | 1 day |
| EDRS & Doctor / Cause of Death | 3 days |
| Permit & Authorization Sent to Crematory | 1 day |
| DC Application Sent | 2 days |
| Ready for Pickup / Contact Family | 4 days |

A case is **overdue** when its days-waiting-in-current-stage exceeds the stage's target and the case is not yet completed. Overdue status is shown as an inline "overdue" tag on the case's row and counted on the Reports screen, but — per a precise re-check of the actual logic while grounding the domain layer in Phase 4 — it does **not** by itself add a case to the Dashboard's "Needs attention" panel; see the correction below. SLA targets are configurable per-organization overrides on top of these defaults (an admin-level setting).

## The "Needs Attention" Rule

**Correction (Phase 4):** an earlier version of this document stated that overdue and veteran-incomplete cases both surface on the Dashboard's "Needs attention" panel. Re-checking the actual working prototype's code line by line during Phase 4 domain-layer work showed that isn't what it does.

The panel's case list and count (`urgentCases`/`attentionCount` in `design/support.js`) are filtered **solely** on a case's `stalled` flag — an explicit annotation staff set on a case (with a free-text reason, e.g. "waiting on ME release," "death cert not yet filed by physician"), not auto-detected from SLA breach or veteran status.

Separately, `buildCase()` *does* compute an `attentionReason` string that falls back to `"Veteran — VA process incomplete"` for a veteran case whose VA workflow isn't done — but since that field is only ever displayed for cases already in `urgentCases` (which requires `stalled: true`), and a stalled case's `attentionReason` always resolves to its `stalledReason` instead, **that veteran-incomplete branch is unreachable in the current build** — it appears to be an incomplete or abandoned feature in the original prototype, not a working rule. The domain layer (`domain/cases/viewModel.ts`) faithfully reproduces the prototype's actual behavior (attention driven by `stalled` alone) rather than "fixing" this — see that module's comments, and flag it to the client if the intended behavior (veteran-incomplete cases *should* surface on the dashboard) is worth implementing as a deliberate improvement in a later phase.

## Veteran / VA Notification Workflow

If a decedent is flagged as having served in the armed forces, a sub-workflow appears on the case:

1. Called the VA
2. VA called back with a date *(locked until step 1 is done)*
3. Called Military Honors *(locked until step 2 is done)*

Once step 2 ("VA called back with a date") is complete, the case must decide whether to **publish** the service or **keep it private** — this choice, plus all three steps being complete, is what makes a veteran case's VA status "Complete" rather than "In progress" (tracked and surfaced on the Reports screen's Veteran/VA panel).

The veteran flag itself can only be toggled while the case is still in **First Call & Payment or Payment** (raw stage ≤ 1) — once the case has moved past that point, the veteran flag is locked and can no longer be changed.

## Notify-Crematory Flag

If the decedent's recorded weight exceeds 200 lb, the Case Information panel shows a "Notify crematory" flag next to the weight field. This is a display flag only in the current design — it does not block any stage transition, it exists to make sure staff physically communicate it to the crematory.

## Required Documents by Stage

Document requirements accrue automatically as a case advances, independent of anything the staff member uploads manually:

- **Before "Permit & Authorization" stage** (raw stage < 4): a **Cremation Authorization** document is expected — shown as "Signed" once the case has reached the Permit & Authorization stage, "Pending" before that.
- **At "Permit & Authorization" stage and beyond** (raw stage ≥ 4): a **Death Certificate** (shown as "Filed" once the case reaches "DC Application Sent," i.e. raw stage ≥ 5, otherwise "Pending") and a **Cremation Permit** (shown as "Signed" once the case has reached "Permit & Authorization," i.e. raw stage ≥ 4) are both expected.

Staff can additionally upload arbitrary documents to a case (e.g. payment invoices, pickup ID, scanned physical paperwork) — these are tracked with who uploaded them and when, and every document (auto-required or uploaded) can be printed individually or all at once. See [ARCHITECTURE.md](./ARCHITECTURE.md) for why uploaded documents live in the compliance service (Postgres + object storage) rather than in Wix Data.

## Case Log

Every case has a running log of two kinds of entries, chosen via a tab:

- **Note** — free text (e.g. "Family requested a biodegradable urn").
- **Contact** — a structured record of a phone call: who was contacted (e.g. "ME's office"), who was spoken with (a name), and an optional summary. This is the record of "who was called, who you spoke with, and when" that the office currently has to keep track of informally.

Every entry records its author (the case's current owner, or "Office" if unowned) and a timestamp, and the full log can be printed for a case.

## Activity Timeline

A case's activity timeline is **auto-derived**, not manually logged: it is built by walking every completed checklist item across every stage the case has already passed through (attributing removal-team and dispatch-related steps to "Removal team," permit-signing to "Funeral director," and everything else to the case's current owner), plus every checklist item completed in the current stage. This produces a "who did what, and how long ago" feed with no separate data-entry step required from staff.
