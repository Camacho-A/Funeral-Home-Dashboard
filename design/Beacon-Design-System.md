# Beacon Design System v1.0
### Official specification — extracted from approved screens (Dashboard, Active Cases, Case Details, Add New Case, Tasks, Documents, Staff Management, Reports & Analytics, Settings & Administration)

---

## 1. Design Principles

**Visual style:** Warm-neutral, calm, minimal enterprise SaaS. Grayscale-first surface system with a single navy-indigo accent and a strict red-only-for-attention rule.

**Personality:** Quiet, trustworthy, unhurried — never alarming. A funeral home's software should never visually mirror the stress of the job.

**Tone:** Professional and plain-language. No jargon, no gamification, no cutesy copy.

**UX goals:** Reduce clicks, reduce ambiguity, always answer "what needs attention, what's next, who owns it" at a glance.

**Design philosophy:** Reuse over invention. Every new screen composes existing components; net-new components are added only when a genuine new interaction pattern is required (documented in each session's "Reusable Components Identified").

**Accessibility philosophy:** Calm ≠ low-contrast. Muted tones are chosen at sufficient contrast ratios; the red/green semantic colors are never the *only* signal (always paired with text/label), so color-blind users aren't dependent on hue alone.

---

## 2. Color System

All colors defined in OKLCH for perceptual consistency.

- **Primary accent (navy-indigo):** `oklch(0.32 0.1 265)` — buttons, active nav, links, focus rings. Hover: `oklch(0.28 0.1 265)`. Light tint (chips/backgrounds): `oklch(0.87-0.91 0.04-0.06 265)`.
- **Attention / Error red:** `oklch(0.5 0.15 25)` text/icons, `oklch(0.95 0.045 25)` background tint. Reserved exclusively for: overdue SLA, missing required documents, blocked status, destructive confirmations. Never used decoratively.
- **Success green:** `oklch(0.6 0.13 145)` (checkmarks, completed states) / `oklch(0.5 0.11 145)` (text). Reserved exclusively for true completion (e.g., ashes actually picked up, Approved documents) — never used to mean merely "fine."
- **Neutral background:** `oklch(0.97 0 240)` page canvas, `oklch(0.94-0.995 0 240)` card/sidebar surfaces (true neutral gray, 0 chroma).
- **Borders:** `oklch(0.88-0.9 0 240)`, hairline weight.
- **Text:** primary `oklch(0.25-0.3 0.02 60)`, muted/secondary `oklch(0.5-0.55 0.015 60)`, disabled `oklch(0.7 0.01 60)`.
- **Hover states:** backgrounds darken ~3-5% lightness; text links darken to their "pressed" navy variant.
- **Selected state:** navy tint background (`oklch(0.86-0.89 0.05-0.06 265)`) + navy text.
- **Disabled:** 60-70% lightness gray text/border, no hover feedback, `not-allowed` cursor.
- **Dark mode (future):** invert lightness values while preserving hue/chroma ratios; red/green semantic meaning must remain identical.

---

## 3. Typography

- **Font family:** Work Sans (Google Fonts), weights 400/500/600/700/800. Sans-serif fallback stack.
- **Page title:** 24-28px / weight 700 / -0.015em tracking.
- **Section header:** 14-15px / weight 700.
- **Card label (eyebrow):** 11-11.5px / weight 600-700 / uppercase / 0.03-0.04em tracking / muted color.
- **Body / row text:** 13-13.5px / weight 400-600.
- **Small/meta text:** 11-12px / muted color.
- **Stat/KPI numbers:** 26-28px / weight 800 / tight tracking.
- **Line height:** 1.2-1.6 depending on density (tighter for labels, looser for paragraph-style note text).
- **Hierarchy rule:** weight and color carry hierarchy more than size — most UI text sits in a narrow 11-15px band; distinction comes from weight (400→800) and muted-vs-primary color.

---

## 4. Spacing System

- **Base unit:** 4px (all spacing values are multiples of 2 or 4).
- **Card padding:** 16-22px depending on card size (compact stat card ~16-18px, primary content card ~18-22px).
- **Section gaps:** 14-16px between sibling cards, 20-28px between major page sections.
- **Table/row padding:** 10-16px vertical, 20-22px horizontal.
- **Border radius:** 8-10px small controls, 12-16px cards, 18-20px large dashboard cards, 50% avatars/dots.
- **Container:** content area flexes to fill viewport minus a fixed ~208-216px sidebar; no fixed max-width (operational density > marketing-page centering).
- **Responsive spacing:** scales down ~20% on tablet, collapses to single-column stacking with 12-16px gaps on mobile.

---

## 5. Layout System

- **Sidebar:** fixed ~216px, light-neutral surface, logo mark + nav list + footer org info. Persistent across all screens.
- **Top bar:** ~72px, search (left/center), primary action button (right), avatar (far right). Persistent.
- **Page header:** title + count/subline + primary action, left-aligned, ~24-28px title.
- **Section header:** 14-15px bold label above each card/group.
- **Card layout:** white surface, subtle shadow (`0 1px 2px rgba(0,0,0,.03), 0 2px 10-12px rgba(0,0,0,.03)`), no border on dashboard-tier cards; 1px hairline border on form/detail-tier cards.
- **Dashboard grid:** stat-card row (3-6 across) → two-column primary content (∼1.3fr/1fr) → full-width list/feed.
- **Breakpoints:** Desktop (primary target, full multi-column), Tablet (~768-1024px: columns collapse to fewer, filters wrap), Mobile (<768px: single column, table view disabled in favor of Card view, filters collapse to a sheet).

---

## 6. Button System

- **Primary:** solid navy fill, white text, 9-10px radius, 9-10px vertical / 16-20px horizontal padding, weight 600, no border.
- **Secondary/pill-chip:** light navy tint background, navy text, same radius, used for active filters/tabs.
- **Ghost/text-link:** no background, navy text, underline on hover for inline links; plain color-shift for action links ("Print," "Upload").
- **Danger:** red text/fill reserved strictly for destructive confirms (Delete), never for a standard secondary action.
- **Icon buttons:** kebab (⋯) or ×, muted gray, no border, hover background tint.
- **Sizes:** single standard size per level (no small/medium/large proliferation) — density is controlled by padding, not by multiple button scales.
- **States:** hover (darken/tint), focus (visible outline or ring, navy), pressed (slightly darker), disabled (muted gray, `not-allowed`), loading (future: spinner replaces label, button stays same size to avoid layout shift).

---

## 7. Form System

- **Text fields:** 8-10px radius, 1px neutral border, near-white fill, 13px text, no label-above convention on compact rows (placeholder-driven) but explicit small-label-above on structured forms (Case Info, New Case sections).
- **Dropdowns/selects:** same visual weight as text fields; native select styling kept minimal/consistent with app chrome.
- **Search bar:** pill/rounded input, neutral fill, placeholder text describes searchable fields explicitly.
- **Date pickers:** native date input styled to match text fields (no custom calendar widget introduced yet — flagged as a future component if richer date UX is needed).
- **Checkboxes (checklist items):** custom 16-18px rounded-square, navy border, navy or green fill when checked depending on context (in-progress vs. permanently-complete semantics).
- **Switches/toggles:** new component (Settings v1) — pill track, circular thumb, navy when on.
- **Text areas:** same border/radius as text fields, resizable vertically only.
- **Validation:** red border + inline message below field on error; no color-only error signaling — always paired with text.
- **Required fields:** implied by lock/gating logic rather than asterisks in most of Beacon (sequential checklist gating IS the required-field system); asterisk convention available for simple forms.
- **Helper text:** 11-12px muted, directly under the field.

---

## 8. Table System

- **Header row:** 11px uppercase muted labels, hairline bottom border.
- **Sorting:** click header, small directional indicator, minimal new component.
- **Pagination:** bottom-right, muted text ("‹ Prev · 1 2 3 · Next ›" style), quiet weight.
- **Filters:** chip/pill row above the table, multi-select combining via AND logic, "clear" text link.
- **Bulk selection:** checkbox per row, contextual action bar slides in above the table when ≥1 selected (navy pill actions).
- **Hover state:** subtle background tint on row hover, cursor pointer (rows are always clickable to open detail).
- **Expandable rows:** not used to date; slide-over detail panel is the established alternative — do not introduce row-expansion as a competing pattern.
- **Empty/loading states:** see Section 14.

---

## 9. Card System

- **Dashboard/stat card:** 16-20px radius, soft shadow, no border, large bold number + muted label; red-tinted background variant reserved for the one "needs attention" card.
- **Case/task/document row-card:** used interchangeably with table rows depending on Table/Card view toggle; avatar + name + status badge + one line of contextual subtext.
- **Detail/section card:** 12-14px radius, 1px hairline border, white fill, section-label header, used for Case Information, Checklist, Case Log, Documents, etc.
- **Elevation:** two-tier system only — flat-with-border (detail cards) and shadow-no-border (dashboard/stat cards). Do not mix a third elevation style.
- **Hover:** row/card-level pointer cursor + background tint; stat cards are static (non-interactive) unless explicitly a filter trigger.

---

## 10. Status System

- **Case stage badges:** pill, 11-11.5px bold, colored per the two-tone rule (red = Awaiting ME/Doctor bottleneck stage only, navy-neutral tint = everything else, green = Completed only once gated condition met).
- **Task status:** Not Started/In Progress/Waiting (neutral), Blocked (red), Completed (green), Cancelled (muted/struck).
- **Priority:** small colored dot + text, not a full badge — Critical = red dot, High = dark-neutral tag, Normal/Low = plain text, no color.
- **Document status:** Missing/Rejected/Expired = red; Uploaded/Pending/Awaiting Signature/Archived = neutral; Approved = green (Approved/Rejected scoped only to documents requiring external sign-off).
- **Availability (staff):** small dot, same visual language as priority dots — Available (green-tinted or neutral, TBD low-alarm color), Busy (neutral), On Leave (muted), On Call (navy accent dot).
- **Usage rule (system-wide):** red is never decorative and never used for more than one severity tier at a time on a given screen; green never means "in progress," only "truly done."

---

## 11. Icons

- Beacon deliberately avoids a custom icon library — the design system uses **shape primitives** (circles, dots, small rounded squares) and **typographic glyphs** (✓, ×, ⋯, ‹ ›) rather than an icon font/SVG set, keeping the whole app in the same restrained visual vocabulary established from session 1.
- Where a real icon system is introduced later (e.g., for document-type glyphs), it should follow a single consistent stroke-based style (recommend 1.5px stroke, 16-20px bounding box) rather than mixing filled and outlined icons.
- Icons are never used purely decoratively — only as a functional affordance (remove ×, menu ⋯, checkmark ✓).

---

## 12. Navigation

- **Sidebar:** flat list, no nested flyouts — Dashboard, Active Cases (formerly implicit in Dashboard), Tasks, Reports, Settings. Active item = navy tint pill.
- **Top bar:** persistent search + primary action, not a nav element itself.
- **Tabs:** used sparingly (e.g., Table/Card view toggle, Reports' location selector) — pill-group style, not underline-tabs.
- **Breadcrumbs:** not used — Beacon favors a single "← Back to X" text link (established in Case Detail) over multi-level breadcrumb trails, consistent with a shallow (2-level max) navigation depth.
- **Dropdown navigation / menus:** kebab menus for row-level actions only; no dropdown mega-menus.
- **Hierarchy:** Sidebar (top-level sections) → optional Tab/toggle (view mode within a section) → slide-over panel (single-record detail). Maximum 3 levels deep, always.

---

## 13. Modals & Drawers

- **Standard modal:** centered overlay, dark scrim, white rounded panel (16px radius), used for New Case, Upload Document.
- **Confirmation dialog:** same modal shell, condensed content, red confirm button only for destructive actions (Delete).
- **Slide-over drawer:** anchored right, same overlay mechanics as modal but slides from the edge — the established pattern for single-record detail (Task Detail, Document Detail, Staff Profile, Settings sub-panels). Preferred over full-page navigation for anything that shouldn't interrupt a list-scanning flow.
- **Success/error dialogs:** lightweight, dismissible banner-style confirmation reused across Upload, Case Creation, and Bulk Actions rather than a heavy separate dialog component.
- **Usage rule:** modal = creation/input flows that need full focus; drawer = viewing/editing an existing record without losing list context.

---

## 14. Feedback States

- **Success:** green-tinted banner/checkmark, brief, non-blocking.
- **Warning:** amber/neutral-dark tinted inline message (e.g., duplicate-case warning) — distinct from error red, since a warning is advisory, not blocking.
- **Error:** red border/text, always paired with a specific message, never color-only.
- **Empty states:** centered muted icon-placeholder + one line of guidance + relevant CTA — established as a first-class pattern in Documents v2, retroactively applied everywhere (Active Cases, Tasks, Staff, Reports).
- **Loading states:** not yet formalized in detail — recommend a simple skeleton block matching each component's real dimensions (card/row shape) rather than a spinner, to avoid layout jump.
- **Toast notifications:** not yet used; recommend introducing only for transient cross-page confirmations (e.g., "Task reassigned") rather than for anything requiring user reading time.
- **Inline validation:** immediate, on-blur or on-change, red text directly under the field.

---

## 15. Timelines

Two distinct components, deliberately kept separate (explicit UX decision in Case Details v2):
- **Stage stepper / narrative timeline:** horizontal (case header) or vertical (Case Details) dot-and-line, one entry per lifecycle stage, shows date/time/staff/notes — tells the *story* of a case.
- **Audit log:** flat, filterable, chronological list of every field-level change (old value → new value), used identically across Case Details, Documents, and system-wide Settings Audit Log — the *compliance record*, never merged with the narrative timeline.

---

## 16. Data Visualization

Deliberately minimal per the Reports v2 scope decision — charts are a small, trusted set, not a full BI library:
- **KPI/stat cards:** large number + muted label, the primary data-viz unit throughout Beacon.
- **Horizontal bar:** used for stage breakdown, case type, document type — track color neutral gray, fill navy, red only when a bar represents a bottleneck/overdue metric.
- **Sorted list card:** for "Longest Open Cases" style rankings — no chart, just an ordered list.
- **No donut, line, stacked-bar, or heat map components exist yet** — intentionally deferred until real multi-location volume/history justifies trend visualization (documented reasoning in Reports v2).
- **Legend placement:** not yet needed (no multi-series charts exist); when introduced, legends should sit directly above the chart, left-aligned, matching section-label typography.

---

## 17. Responsive Design

- **Desktop:** full sidebar + multi-column layouts, primary design target.
- **Tablet:** table views collapse to fewer columns with an expand affordance; filter bars wrap to two rows; Card view becomes the practical default (touch-friendly, validated specifically for arrangement-conference tablet use).
- **Mobile:** Table view disabled — Card view only, single column; filters collapse into a bottom-sheet modal; sidebar collapses to an icon rail or hidden drawer (not yet fully specified — flag as next responsive-detail pass).
- **Forms:** stack to single column below tablet width.
- **Modals:** remain centered on desktop/tablet; on mobile, expand to near-full-screen.
- **Dashboard:** stat-card row reflows from 4-6 across → 2 across → 1 across as viewport narrows.

---

## 18. Accessibility

- **Color contrast:** all text/background pairs should meet WCAG AA (4.5:1 body text, 3:1 large text) — muted grays were chosen with this floor in mind; verify formally before engineering handoff.
- **Keyboard navigation:** all interactive elements (rows, chips, buttons) must be reachable via Tab and operable via Enter/Space — currently a design gap to formalize in implementation (click-only affordances documented throughout should gain keyboard equivalents).
- **Focus states:** visible navy focus ring on all interactive elements, no focus-outline removal.
- **Screen reader labels:** icon-only buttons (kebab, ×, print) require `aria-label`s describing the action, not just the glyph.
- **Touch targets:** minimum 44×44px tappable area on any mobile-facing control, even where the visual element is smaller (e.g., a 16px checkbox needs a larger invisible hit area).
- **Font sizes:** never below 11px anywhere in the system; body content stays ≥13px.
- **ARIA:** status badges should carry `role="status"` or equivalent live-region treatment where they reflect changing state (e.g., SLA overdue flipping on).
- **WCAG target:** AA compliance minimum across the platform; AAA not required given operational (not public-facing) context.

---

## 19. Component Inventory

**Foundation**
| Component | Purpose | Used In | Variants | States |
|---|---|---|---|---|
| Page shell (sidebar + top bar) | App chrome | All screens | — | active nav item |
| Stat/KPI card | Headline metric | Dashboard, Tasks, Documents, Staff, Reports | red-attention / neutral | static, clickable-filter |
| Section card | Grouped content container | All detail screens | bordered / shadow-only | — |
| Status badge (pill) | Case/task/document state | Everywhere | red/neutral/green | — |
| Priority/availability dot | Lightweight severity signal | Tasks, Staff | red/dark/plain | — |

**Controls**
| Component | Purpose | Used In | Variants | States |
|---|---|---|---|---|
| Primary button | Main CTA | All screens | — | hover/focus/disabled |
| Text-link action | Inline action (Print, Upload, clear) | All screens | — | hover |
| Chip filter | Toggle a filter | Active Cases, Tasks, Documents, Reports | active/inactive | — |
| Kebab menu | Row quick actions | Active Cases, Tasks, Documents, Staff | — | open/closed |
| Toggle switch | Boolean setting | Settings | on/off | disabled |
| Checklist item | Gated sequential task | Case Detail, VA workflow | locked/unlocked/done | — |

**Data Display**
| Component | Purpose | Used In | Variants | States |
|---|---|---|---|---|
| Table/Card view toggle | Density preference | Active Cases, Documents, Staff | table / card | — |
| Sortable table | Row-based data list | Active Cases, Tasks, Documents, Staff, Audit Log | — | hover, selected |
| Case/task/document row-card | Compact record summary | All list screens | — | — |
| Horizontal bar (mini-chart) | Distribution/bottleneck viz | Reports | red-flagged / neutral | — |
| Stage stepper | Case lifecycle position | Dashboard, Case Detail | horizontal / vertical | done/current/upcoming |
| Audit log row | Field-change record | Case Detail, Documents, Settings | — | — |
| Case Log entry (note/contact) | Unified log feed | Case Detail | note / contact | pinned |

**Overlays**
| Component | Purpose | Used In | Variants | States |
|---|---|---|---|---|
| Modal | Creation flow | New Case, Upload Document | — | — |
| Confirmation dialog | Destructive confirm | Delete actions | — | — |
| Slide-over drawer | Single-record detail | Task, Document, Staff Profile, Settings | — | — |
| Bulk action bar | Multi-select actions | Active Cases, Tasks, Documents | — | appears on selection |
| Empty state | No-data guidance | All list screens | — | — |

**Future reuse:** every component above is designed to be data-source-agnostic (case/task/document/staff all share the same row-card and badge shape), so extending to a second location or new record type requires no new visual component — only new data bindings.

---

## 20. Engineering Handoff — Build Order

**Phase 1 — Foundation (build first, blocks everything else)**
1. Typography scale + Work Sans loading
2. Color tokens (OKLCH values above, as CSS variables/theme constants)
3. Spacing/radius scale
4. Page shell (sidebar + top bar)

**Phase 2 — Primitives**
5. Buttons (primary/ghost/danger/icon)
6. Text input, select, textarea, toggle switch
7. Status badge + priority/availability dot
8. Section card + stat card

**Phase 3 — Data Display**
9. Sortable table + pagination
10. Row-card (case/task/document/staff shared shape)
11. Chip filter bar + search input
12. Table/Card view toggle
13. Bulk action bar

**Phase 4 — Navigation & Overlays**
14. Sidebar nav + active state
15. Modal shell + confirmation dialog
16. Slide-over drawer
17. Empty states

**Phase 5 — Feature Components**
18. Stage stepper (horizontal + vertical)
19. Checklist item (with locking logic)
20. Case Log entry (note/contact unified feed)
21. Audit log row
22. Horizontal bar chart (mini)
23. Access Level preset control

**Phase 6 — Pages (compose Phases 1-5, in this order)**
24. Dashboard
25. Active Cases
26. Case Details
27. Add New Case
28. Tasks
29. Documents
30. Staff Management
31. Reports & Analytics
32. Settings & Administration

This order lets Claude Code build a working component library before any page exists, so every page is assembly rather than fresh construction — matching how the actual Beacon prototype was built (one shared visual system, composed per screen).
