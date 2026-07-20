# User Roles

Beacon has no public-facing users in Version 1 — every account is a staff member of the funeral home, authenticated via Wix Members, with a role stored in `StaffProfiles.role` (see [CMS_SCHEMA.md](./CMS_SCHEMA.md)). Role checks happen in both `middleware.ts` (page-level gating) and in every Route Handler (action-level gating), reading from the same permission table so the two can't drift apart. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the session/auth mechanics.

## `admin`

Full access to everything `funeral_director` and `staff` can do, plus organization-level administration:

- Manage staff accounts and roles (`StaffProfiles`).
- Configure organization settings (company name, pickup schedule, SLA overrides — the fields the design's `Component` state currently hardcodes as `companyName`, `pickupSchedule`, `slaOverrides`).
- Full visibility into Reports, including staff workload across the whole office.

## `funeral_director`

The primary working role — the person actually running cases day to day:

- Create new cases (New Case / First Call modal).
- View, edit, and advance any case regardless of who it's assigned to.
- Reassign a case's owner (the "Owner" select on the Case Detail screen).
- Bulk-advance cases to the next stage from the dashboard's stage-filtered view.
- Toggle the veteran/armed-forces flag and run the VA notification sub-workflow, including the publish/private decision (locked to certain stages per [BUSINESS_RULES.md](./BUSINESS_RULES.md)).
- Add and complete checklist items, case log entries, and case-linked tasks.
- Upload, view, print, and remove documents on a case.
- View Reports.

## `staff`

Day-to-day operational access without ownership/administrative actions:

- View assigned cases (and, per the dashboard's design, the full case list — visibility is office-wide, not siloed per staff member, matching the "All cases" list in the current design).
- Update checklist items and case log entries on cases they're working.
- Add and complete case-linked and general tasks.
- Upload documents.
- Read-only on case core fields (decedent info, stage) and on Reports — a `staff` account can see the numbers but not reassign ownership or bulk-advance cases.

## Design Rationale

The roles above are inferred from what the approved design (`design/Beacon.dc.html`) implies is a "management" action versus a "working" action — owner reassignment, bulk stage-advance, and the veteran/VA callback decision read as director/admin-level judgment calls, while checking off a checklist item or adding a task reads as something any staff member does constantly. This split should be revisited once real usage at Managed Cremations validates it; it is a starting point, not a fixed requirement from the client.
