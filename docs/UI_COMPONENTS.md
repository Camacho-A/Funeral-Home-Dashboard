# UI Components

This document is the authoritative breakdown of the UI defined in `design/Beacon.dc.html`, translated into a component hierarchy and design-token reference for the Next.js implementation. The design file is treated as an immutable visual specification (see [DECISIONS.md](./DECISIONS.md), ADR-004) — every component and token below was extracted directly from it, not invented independently.

## Rendering Model of the Source Design

`Beacon.dc.html` is a single-page, client-state-driven prototype rendered by `support.js` ("dc-runtime," a small proprietary templating engine — mustache-style `{{ }}` interpolation, `<sc-if>`/`<sc-for>` control-flow tags). One `Component` class holds a single flat `state` object (~25 keys) and a `view` field (`dashboard | case | tasks | reports`) that switches which section renders — there is no URL-based routing in the source. A `renderVals()` / `buildCase()` pair does all data derivation: raw case data plus several state slices are transformed into roughly forty computed display fields per case (badge colors, checklist state, timeline, document list). **That derivation logic is the most important thing to preserve exactly** when this becomes a real app — it is the actual business logic, not incidental UI plumbing. dc-runtime itself is not ported; Next.js/React replaces it directly.

## Component Hierarchy

```
AppShell                                    (full-height flex row)
├── Sidebar                                 (fixed 216px)
│   ├── Brand                               (logo mark + "Beacon" wordmark)
│   ├── NavList
│   │   └── SidebarNavItem × 4              (Dashboard, Tasks, Reports, Settings[disabled])
│   └── FooterInfo                          (org name + "N staff online")
└── MainColumn
    ├── TopBar                              (72px)
    │   ├── SearchInput                     (search by name, phone, tag number)
    │   ├── NewCaseButton                   (opens NewCaseModal)
    │   └── UserAvatar                      (initials badge)
    │
    ├── DashboardView                       (shown when view = 'dashboard')
    │   ├── PageGreetingHeader              (greeting + date + active count)
    │   ├── NeedsAttentionPanel
    │   │   └── UrgentCaseRow × N           (stalled or veteran-incomplete cases)
    │   ├── CasesByStagePanel
    │   │   └── StageBarRow × 7             (clickable → sets stage filter)
    │   ├── AllCasesList                    (hidden while a stage filter is active)
    │   │   └── CaseListRow × N             (search-filtered, sorted stalled-first)
    │   ├── StageFilteredPanel              (shown when a stage bar is clicked)
    │   │   ├── BulkActionBar               ("Advance N to next stage")
    │   │   └── CaseFilteredRow × N         (each with a SelectCheckbox)
    │   └── RecentActivityPanel
    │       └── ActivityRow × N
    │
    ├── CaseDetailView                      (shown when view = 'case')
    │   ├── BackToDashboardLink
    │   ├── CaseHeader                      (name, DOB/DOD, case #, StageStatusBadge, SLA line)
    │   ├── StageStepper
    │   │   └── StepperNode × 7             (clickable — view a past stage read-only)
    │   ├── LeftColumn
    │   │   ├── CaseInformationCard
    │   │   │   ├── InfoField × 9           (DOB, DOD, TOD, location, weight[+flag], NOK, NOK phone, payment, owner)
    │   │   │   ├── OwnerSelect
    │   │   │   ├── VeteranToggleRow
    │   │   │   └── VaNotificationPanel     (shown if veteran flag set)
    │   │   │       ├── VaStepRow × 3       (locked in order)
    │   │   │       └── PublishChoiceButtons (Publish / Keep private)
    │   │   ├── ChecklistCard
    │   │   │   ├── ViewingPastStageBanner  (shown when viewing a read-only past stage)
    │   │   │   └── ChecklistItem × N
    │   │   │       └── ChecklistFieldInput (only for First Call & Payment's data-entry items)
    │   │   ├── CaseLogCard
    │   │   │   ├── LogTypeTabs             (Note / Contact)
    │   │   │   ├── NoteForm | ContactForm
    │   │   │   └── LogEntryRow × N
    │   │   └── CaseTasksCard
    │   │       ├── CaseTaskRow × N
    │   │       └── TaskQuickAddForm
    │   └── RightColumn
    │       ├── ActivityLogCard             (auto-derived timeline; Print)
    │       │   └── TimelineRow × N
    │       ├── DocumentsCard                (auto-required + uploaded; Print/Print all/Upload/Remove)
    │       │   └── DocumentRow × N
    │       └── HiddenFileInput             (shared upload target, ref-based)
    │
    ├── TasksView                           (shown when view = 'tasks')
    │   ├── TaskComposer                    (text + AssigneeSelect + CaseLinkSelect + Add)
    │   └── TaskList
    │       └── TaskRow × N                 (checkbox, text, linked-case link, assignee chip, remove)
    │
    ├── ReportsView                         (shown when view = 'reports')
    │   ├── OrgSwitcher                     (disabled; already lists a 2nd "coming soon" org)
    │   ├── KpiTileRow
    │   │   └── KpiTile × 4                 (Active / Completed / Overdue on SLA / Total)
    │   ├── TimeInStagePanel
    │   │   └── StageAvgRow × 7
    │   ├── StaffWorkloadPanel
    │   │   └── StaffLoadRow × N
    │   └── VeteranCasesPanel
    │       └── VeteranCaseRow × N
    │
    └── NewCaseModal                        (overlay, shown when showNewCaseModal)
        └── FieldGroup × 3                  (Decedent / Contacts / Payment)
            └── TextField × N
```

## Reusable Primitives

These patterns repeat across nearly every screen in the source, styled inline and slightly differently each time — they should collapse into one shared component each, in `components/ui/`:

| Component | Where it appears in the source | Notes |
|---|---|---|
| `Checkbox` | Checklist items, veteran toggle, VA steps, dashboard bulk-select, case tasks, stage-stepper node | Square box with a checkmark glyph; only color and size vary — one component with color/size props. |
| `Badge` / `Pill` | Stage status badge, SLA-overdue tag, assignee chip, VA status, "notify crematory" flag | Rounded pill, background/text color pair driven by a semantic variant (neutral/brand/danger/success). |
| `Card` | Nearly every panel on every screen | White background, rounded corners, either a border or a soft shadow depending on context (dashboard panels use shadow; case-detail panels use a border). |
| `Button` | Primary filled action ("+ New Case," "Create case"), ghost/text-link action ("Print," "← back"), pill action ("Add entry," bulk-advance) | Three consistent visual variants. |
| `Modal` | NewCaseModal (the only instance today) | Should be built as a generic, reusable overlay component from the start, not a one-off. |
| `TextField` / `SelectField` / `TextArea` | Search input, all case-info/checklist/log/new-case form fields | Consistent bordered, rounded input styling throughout. |

## Design Tokens

Extracted from the `<style>` block and inline styles in `design/Beacon.dc.html`. These should be codified once, in `styles/tokens.css`, and consumed everywhere rather than repeated inline.

**Color (OKLCH)**
- Brand / primary: `oklch(0.32 0.1 265)` — buttons, current-stage indicators, checked boxes, links, focus states.
- Brand tint (selected/active backgrounds): `oklch(0.86–0.89 0.05–0.06 265)`.
- Danger / attention (hue 25): background `oklch(0.93–0.96 0.03–0.045 25)`, text `oklch(0.4–0.5 0.08–0.15 25)` — "Needs attention" panel, overdue tags, weight-over-200 flag.
- Success (hue 145): `oklch(0.6 0.13 145)` — completed checkmarks, "Paid in full" status.
- Neutral text/borders: low-chroma grays at hue 60, stepped across several lightness values for primary/secondary text, borders, and disabled states.
- Base page background: `oklch(0.94 0 240)`.

**Typography**
- Typeface: Work Sans (weights 400, 500, 600, 700, 800), loaded from Google Fonts.
- Sizes range from ~10px (meta text) to 26–28px (page/KPI headers), all defined per-element rather than from a shared scale in the source — a real type scale should be introduced during implementation without changing the visual result.

**Radius**
- 5–9px: small controls (checkboxes, select/input fields).
- 10–14px: cards and inputs.
- 18–20px: large panels and the modal.
- 50%: avatars and status dots.

**Other**
- No dark mode exists in the source — it is a single, fixed light theme.
- Custom scrollbar styling (thin, rounded thumb) is applied globally.

## Responsive Strategy

The source design is fixed-width and desktop-only: a 216px sidebar, two-column grids on the Case Detail and Reports screens, and no media queries anywhere. This is consistent with the client's direction to prioritize the authenticated staff desktop experience over mobile or public-facing responsiveness for V1 (see [PRODUCT_VISION.md](./PRODUCT_VISION.md)). Recommendation: preserve this fixed desktop layout exactly for V1, but isolate the grid/column structure inside a small number of layout components (not scattered inline styles) so a later responsive pass is additive rather than a rewrite.
