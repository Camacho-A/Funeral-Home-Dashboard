# Product Vision

## What Beacon Is

Beacon is an operations platform for funeral homes and cremation providers. It replaces the spreadsheets, sticky notes, and paper case files that most small-to-mid-size funeral homes currently rely on to track a case from first call through final disposition, with a single system of record that enforces the provider's own operating procedure at every stage.

Beacon is not a website builder, an obituary publisher, or a point-of-sale system. It is the internal tool the staff of a funeral home use every day to know: which cases are open, what's overdue, who owns what, and what's still missing before a case can move forward.

## Who It's For

**Version 1** is built for a single client, Managed Cremations (operating as Manor Cremation), a cremation-focused provider. Version 1 ships as a single-tenant deployment, but the data model and every architectural decision documented here assume Beacon will grow into a **multi-tenant SaaS product** serving many independent funeral homes, each with their own staff, cases, and data, fully isolated from one another. See [DECISIONS.md](./DECISIONS.md) for how that constraint shapes the schema from day one, and [ARCHITECTURE.md](./ARCHITECTURE.md) for the mechanics.

The users are internal staff: funeral directors, office staff, and administrators. There is no public-facing or family-facing surface in Version 1 — Beacon V1 is a staff tool, full stop.

## The Problem Beacon Solves

Funeral home operations are procedure-heavy and time-sensitive in ways that generic task/CRM software doesn't model well:

- **Every case has a mandatory, regulated sequence of steps** (first call and payment, EDRS/death-certificate filing, permit and authorization to the crematory, DC application, pickup, family notification) that cannot be skipped or reordered, and several of those steps involve documents that are legally required to exist and be retrievable later.
- **Time matters and is audited.** A case sitting too long in "waiting on the Medical Examiner" or "cause of death not yet entered" is a problem the office needs to see immediately, not discover a week later. Each stage has a target turnaround time (an SLA), and cases that blow past it need to surface themselves, not wait to be noticed.
- **A lot of institutional knowledge currently lives in people's heads or a paper folder**: who was called, who picked up, what the family asked for, whether the decedent was a veteran and whether the VA has been notified. When that's on paper, it doesn't survive a staff member being out sick, and it isn't there when a family calls asking for an update.
- **Compliance documents (death certificates, cremation permits, signed authorizations) need to be retrievable long after a case is "done"** — for at least as long as state retention requirements demand, independent of whatever software the office happens to be running that year.

Beacon's job is to make the *correct* next step obvious, make delays visible before they become a family's or a regulator's problem, and keep a permanent, auditable record of what happened and when.

## Version 1 Scope

Version 1 delivers exactly what is visualized in the approved design (`design/Beacon.dc.html`) — four screens behind a staff login:

1. **Dashboard** — what needs attention today, a breakdown of the case load by stage, the full case list (searchable), and a recent-activity feed.
2. **Case Detail** — the full record for one case: decedent and next-of-kin information, the stage stepper, the stage-specific checklist (including the "first call" data-entry steps), the veteran/VA notification workflow, a free-form case log, per-case tasks, an auto-generated activity timeline, and the document file for that case.
3. **Tasks** — a lightweight, office-wide to-do list, optionally linked back to a case.
4. **Reports** — case-load KPIs, time-in-stage vs. SLA target, staff workload, and veteran/VA case status, scoped (today) to the one funeral home, with the UI already anticipating a second organization being added later.

## Explicitly Out of Scope for Version 1

These are real, planned capabilities — not rejected ideas — but they are not part of this build:

- **Public memorial pages and obituaries.** Nothing in V1 is visible to the public or to families directly; there is no publishing surface.
- **Service scheduling.** Booking chapels, hearses, or staff time for visitations, funerals, or cremations is not part of V1.
- **Merchandise and payments.** Selling caskets, urns, or flowers, and collecting pre-need or at-need payment through the platform, is not part of V1 (the *fact* that a case has been paid for is tracked as a status field today; actual payment processing is not).

See [ROADMAP.md](./ROADMAP.md) for how these layer on top of the V1 foundation.
