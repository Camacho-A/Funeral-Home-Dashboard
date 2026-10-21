# SLA tracking (Manors)

Introduced 2026-10. SLA tracking watches each hand-off in a case, counted in
business days, so cases don't sit without action. It separates delays that
belong to staff from waits on the family, doctor, state or crematory.

It is enabled per organization (`features.slaTracking`), for Manors only. Gus
SOLIS and every other organization behave exactly as before.

## One engine

`domain/sla/slaMilestones.ts#evaluateCaseSla` is the only place SLA status is
calculated. The case header, the SLA details panel, the dashboard and the
alert sweep all call it, so they can't disagree.

## Business days (`domain/sla/businessCalendar.ts`)

- Business days are Monday to Friday in the organization's timezone
  (America/New_York), minus configured holidays.
- Everything works on local calendar dates, so daylight saving changes
  never move a deadline.
- **Closing time** (default 17:00): a deadline is the closing time on its
  due date. Until then the item is "Due Today"; after that it's "Overdue".
- **After-hours cutoff** (default 17:00): an event at or after the cutoff,
  or on a weekend or holiday, counts from the next business day.

## Milestones

| Milestone | Starts | Stops | Target | Responsible |
|---|---|---|---|---|
| EDRS entry | case received | EDRS submitted to doctor | 2 | staff |
| Doctor attestation | EDRS submitted | attestation received | 4 | doctor |
| Hard Save | attestation received | Hard Save | same day | staff |
| State approval | Hard Save | approval received | 2 | state |
| Crematory turnaround | crematory receipt | cremains ready | 5 (fixed return days optional) | crematory |
| Family pickup | cremains ready | authorized release | 5, advisory | family |

Each milestone is independent of the six-step workflow stage. One stage can
contain several milestones.

For a Medical Examiner case, the first three milestones don't apply, because
the ME does that work. Approval starts when staff confirm the ME's
information.

## Where the times come from

Times come only from recorded events. Nothing is invented.

| Event | Source |
|---|---|
| Case received | Recorded automatically when a case is created by staff or an intake form. A historical import gets none. |
| Vital Statistics received | Recorded automatically when the form arrives (the first time is kept), or by staff. |
| EDRS submitted / Hard Saved / Sent to crematory | The completion record of their checklist items (EDRS submitted & sent to doctor; Attestation Received / Hard Saved; Permit and Authorization sent), or recorded by staff. |
| Attestation / approval / crematory receipt / cremains ready | Recorded by staff. "Cremains ready" also comes from Date Received. |
| Release | The authorized release record (Released To and Released Date), or confirmed shipping delivery. |

A later event implies the earlier ones happened. For example, a Hard Save
implies the attestation arrived, and a permit sent implies approval. A stage
the case has moved past implies its own events. The time of an implied event
is unknown, though, and a milestone whose start time is unknown shows
**Start Date Needed** instead of a deadline.

Existing cases have no recorded times, so their current milestone will
usually show Start Date Needed until staff record when it began.

Date of Cremation is never treated as "cremains ready". Expected Pickup is
never treated as release.

## Statuses

The statuses are On Track, Due Soon, Due Today, Overdue, Waiting on Others,
Exception Acknowledged, Completed and Start Date Needed.

- **Delays:** a delay records a reason, the responsible party, notes, an
  expected resolution date, and who recorded it and when. It changes the
  status to Waiting on Others, or Exception Acknowledged for a family
  vacation or "other". It never moves the deadline or clears the overdue
  fact; both are shown.
- **Delay history:** a new delay supersedes the open one, and both stay in
  the history. Delays are stored per ID, never deleted, and audited.
- **EDRS without family paperwork:** if the Vital Statistics form hasn't
  arrived, a missed EDRS deadline becomes Waiting on Others (the family), not
  a staff failure. Once the form is in, the panel shows how long the
  information has been available to staff.

## Recording and the checklist

Staff record events and delays in **SLA details** under the case header. This
needs case-edit permission, and archived cases are read-only.

Recording an event that a checklist item stands for completes that item. The
completion is attributed as a workflow event and never overrides a staff
decision on that item. Reconciliation and the expected-pickup sync then run,
exactly as for a manual tick.

## Where it shows

- **Case header:**
  - the six-step progress bar;
  - "Step X of 6 · N business days in stage" (from the new `stageEnteredAt`;
    blank when it's unknown);
  - "Current SLA: <milestone> · Due in N business days" with a status pill.
  - The old hardcoded per-stage "target Nd" is no longer shown for Manors.
- **SLA details** (collapsed under the header): every milestone with its
  start, deadline, completion, responsible party and delay history.
- **Dashboard:** compact counts (On track, Due today, Overdue, Waiting on
  others). Needs Attention includes SLA cases: overdue, due today, start date
  needed, due soon for staff milestones, and waits past their target. Each
  row shows the milestone, deadline, business days left or overdue, the
  responsible party and the delay reason.
- **Alerts:** see `docs/SCHEDULED_JOBS.md` §5. "Hard Save due" is sent the
  moment an attestation is recorded.

## Settings

Settings → SLA Targets is for administrators and is organization-scoped. It
covers:

- targets;
- closing time and after-hours cutoff;
- "due soon" window;
- holidays;
- crematory return weekdays;
- alert types.

The settings are stored as `Organization.slaSettings` (Wix
`organizations.slaSettingsJson`). Invalid values fall back to the defaults.
