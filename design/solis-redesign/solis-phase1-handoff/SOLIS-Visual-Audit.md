# SOLIS — Visual Design Audit & Redesign Plan
Based on the screenshots taken Oct 2, 2026 at desktop width: Dashboard, All Cases, Case Detail (Overview, Documents, Activity), Reports, Settings and Accounting.
**Not audited (no screenshots):** a stage-specific case list, the Workflow, Billing and Schedule tabs, Audit Center, and the whole mobile view at 390px. Section F is reasoned from the desktop structure only.

---

## A. Application shell

**Sidebar**
- **Current problem:** The logo block (stacked-stone illustration plus a big bold wordmark) is about 230px tall, so navigation starts a third of the way down. Nav items are text-only and set in a bold warm brown. The selected item is a light-blue pill with a thick left-border bar. The bottom block holds a second logo (the laurel), "MANORS CREMATION" in capitals, and "1 staff online".
- **Why it feels dated:** Two logos in one sidebar compete for identity. The left-border selected state is a 2015-era admin pattern. Without icons the nav can't collapse to a rail, and the bold weight makes every item shout equally.
- **Proposed design:** A compact header (small mark, wordmark, org switcher) about 56px tall. Nav items get a quiet 16px line icon, regular weight, and a selected state that is a subtle filled row with no border bar. Org identity moves into the org switcher at the top, which also prepares for Gus Camacho. "Staff online" becomes small presence avatars, or is removed.
- **What would change:** The sidebar component structure (header, nav groups, footer), a new icon set, and an org-switcher component.

**Topbar**
- **Current problem:** Seven peer items: search, + New Case, underlined "Audit" and "Templates" links, a divider, "Notifications" as text, the full user name, the avatar, and "Sign out".
- **Why it feels dated:** Underlined text links in app chrome, a text label for notifications, and a separate sign-out link all read like an intranet header.
- **Proposed design:** Search on the left, styled as a command bar (⌘K). On the right: the New Case button, a notification bell with a count, and an avatar menu holding the name, profile, security and sign out. Audit and Templates move into the sidebar (an Admin group) or into Settings.
- **What would change:** Topbar layout, a new avatar-menu component, and a notification popover.

**Content canvas**
- **Current problem:** A cool gray canvas (about #EAEAEA) fills the screen, every section sits in a white card with a ~20px radius, and there is no max-width. At wide desktop sizes, case rows stretch about 2,000px, with the name far left and the status far right.
- **Why it feels dated:** White-cards-on-gray everywhere flattens hierarchy, because every block has equal weight. The full-bleed width creates long eye travel and big dead zones (Accounting and All Cases are 70–80% empty).
- **Proposed design:** A white or near-white canvas, with sections separated by spacing and hairline dividers instead of card wrappers. Cards are kept only for things that are truly objects (a KPI, a document preview). Content gets a max-width (about 1280–1440px) and consistent 32px gutters.
- **What would change:** The page layout component and the removal of most card wrappers.

---

## B. Dashboard
- **Current problem:**
  - "Needs attention" takes half the width and shows only "0 cases": a large empty card with a red left-border accent.
  - Cases by stage is useful.
  - Financial summary is a full-width strip with three numbers, formatted "$2340.00" with no thousands separator.
  - Recent activity is 8 rows of "Document downloaded" and "Case updated (checklistState)", which exposes an internal field name.
- **Why it feels dated:** The layout is a stack of fixed-size cards rather than a prioritized briefing. The empty state wastes the most important real estate, and the activity feed is raw log noise.
- **Proposed design:** The header becomes the greeting with a one-line status ("2 active · 0 need attention · next pickup Tue").
  - **Left (wide):** a "Today" work queue showing the cases needing action, each with its next step and owner. When nothing needs attention, it shows a compact calm line ("All caught up") rather than an empty card.
  - **Right (narrow):** a stage pipeline (clickable) and a money snapshot.
  - **Activity:** meaningful events only (stage changes, payments, documents uploaded, calls logged), grouped by case, with human labels.
- **What would change:** A dashboard composition rewrite, an activity-event mapping layer (event type to plain-language label, with noise filtered out), and currency formatting.

## C. Case queues / All Cases
- **Current problem:**
  - A "← Back to Dashboard" link sits on a top-level page.
  - Names are in ALL CAPS.
  - Each row shows only name, case number and last action, on the left, with the stage chip and a "65% Complete" bar far right.
  - There is no search, filter, sort, owner, days-in-stage or next action.
- **Why it feels dated:** It reads as a list of records, not a work queue. "% Complete" is a fake metric for a stage-gated workflow. All caps reads as legacy database output.
- **Proposed design:** A dense table as the default, with Card view for tablet. Columns:
  - Name (title case) and case number
  - Stage chip
  - Next action
  - Owner avatar
  - Days in stage, red only if over target
  - Docs missing count

  A toolbar above holds search, filter chips (stage, owner, needs attention) and saved views. Stage-specific lists become saved filters on this one screen, not separate pages. Rows get quick actions on hover. Remove the back link.
- **What would change:** A new table component, a filter toolbar, and the stage list routes folded into query-param views.

## D. Case Detail workspace (highest priority)
- **Current problem:**
  - **Header:** The name is in ALL CAPS. The most important facts (stage, days in stage, SLA target) are a tiny gray chip top-right.
  - **Stepper:** Sits in its own card with a visible horizontal scrollbar, and the last stage is cut off ("Co…").
  - **Tabs:** Documents contains a second row of tabs (Documents/Forms/History).
  - **Overview:** A four-column grid of uppercase labels over all-caps values (EMMA MORALES SILVA, 515 NW 30TH TERRACE). Read-only text is mixed with inline select dropdowns (Relationship, Payment, Return method, Cremated remains).
  - **Grouping:** Tag #, Payment, Return method and Cremated remains sit under the "Certifier information" heading.
  - **Data drift:** Weight shows "100" with no unit and no >200 lb flag. Time of death shows "7:37 PM" even though military time was the approved decision.
  - **Order of sections:** The Checklist, which is the actual next action, is about 1,500px down, below Case Order.
  - **Case Order:** Four equal-weight outlined buttons plus a disabled gray "Collect Balance with Clover".
- **Why it feels dated:** It is a database form rendered top to bottom, not a workspace. The page doesn't answer "what do I do next?" above the fold, and editing affordances are inconsistent.
- **Proposed design:** A two-column workspace.
  - **Header band:** name in title case, case number, DOB/DOD and weight. On the right: a large stage chip plus "Day 0 of 2", the owner, and a primary action ("Complete step") with a ⋯ menu.
  - **Compact stepper** spanning the full width without scrolling. Short stage names, with the full name on hover; the current step is emphasized and finished steps are green dots.
  - **Main column:**
    - "Next step" panel at the top: this stage's checklist with its gating.
    - Case Log.
    - Documents, inline and grouped by required/missing/on file.
  - **Right rail (sticky):**
    - Case facts grouped sensibly (Decedent · Next of kin · Certifier · Disposition and return), each with a single "Edit" that switches the group into form mode. No permanent inline selects.
    - Balance summary with one primary payment action.
    - Tasks.
  - **Tabs:** Reduced to Overview · Billing · Activity, with no nested tabs. Workflow merges into the Next step panel; Documents and Schedule fold into Overview sections.
- **What would change:** The Case Detail layout rewrite, a new stepper component, edit-mode field groups, a sticky rail, and a restructured tab set.

## E. Shared components
- **Badges:** Every document shows a green "Generated" badge, including uploaded files. Green has lost its meaning. Use badges only for exceptions (Missing, Needs signature) and use neutral metadata for the normal state.
- **Row actions:** Each document row mixes link-style "View Download" with bordered "Print" and "Regenerate" buttons. Standardize on one ghost icon group plus a ⋯ menu, revealed on hover.
- **Buttons:** Too many equal-weight outlined buttons in a row (Case Order, Documents toolbar). Define one primary per region, with the rest as secondary or in an overflow menu.
- **Tabs:** The underline tabs are fine; ban nesting.
- **Labels:** Uppercase tracked labels appear everywhere (KPIs, every field, section headers). Keep uppercase only for small eyebrows. Use sentence-case 12–13px muted labels for fields.
- **Typography color:** Warm brown text on a cool gray canvas reads muddy. Pick one temperature: near-black neutral text with a warm or neutral canvas.
- **Reports and Settings:** Both use the same grid of 28 or so description cards, so the two pages look identical. Reports should show data (KPIs and charts) with the catalog secondary. Settings can stay a list, but as a compact two-column list with icons, not big cards.
- **Activity feed:** Needs event grouping ("Downloaded 9 documents · Oct 1"), filters, and human-readable labels. Never show raw field names like `checklistState`.

## F. Mobile (not inspected — provisional)
- Replace the sidebar with a bottom tab bar (Today, Cases, Tasks, More) and a top search.
- Show case rows as cards: name, stage chip, next action, days.
- Case Detail order on mobile:
  1. Header
  2. Next step checklist
  3. Facts accordion
  4. Log
  5. Documents
- The stepper becomes a "Step 5 of 7" chip with a sheet showing every stage, never a horizontal scroller.
- Run a real 390px screenshot pass before finalizing this section.

---

## Top 10 reasons SOLIS feels dated (ranked)
1. **White cards on gray for everything.** Every section has equal weight, so nothing leads.
2. **Case Detail is a top-to-bottom database form.** The checklist (the next action) sits about 1,500px down.
3. **ALL CAPS names and values** (decedent, NOK, certifier, address) read as legacy system output.
4. **Topbar crowded with underlined text links**: Audit, Templates, "Notifications" as text, a separate Sign out.
5. **Stepper with a visible scrollbar and a cut-off final stage.** The core navigation element looks broken.
6. **Raw log noise in activity feeds**: 9× "Document downloaded" and "Case updated (checklistState)".
7. **No max-width.** Rows span the screen, and pages like Accounting and All Cases are 70–80% empty.
8. **Uppercase tracked labels on every field and KPI**, plus heavy bold weights throughout, so the typography has no rest.
9. **Badge and button inflation**: green "Generated" on everything, four equal outlined buttons per action area, mixed link and button row actions.
10. **Reports is a catalog of 28 link cards with no data**, and it looks identical to Settings.

## The 5 changes with the biggest visual transformation
1. **Rebuild Case Detail as a two-column workspace**: a next-step panel up front, a sticky facts rail, and a compact stepper.
2. **Flatten the surface system**: white canvas, spacing and dividers instead of card wrappers, and a max content width.
3. **Rebuild the shell**: compact sidebar with icons and an org switcher; topbar reduced to command search, New Case, bell and avatar menu.
4. **Turn All Cases into a real work-queue table** with next action, owner, days in stage, filters and saved views.
5. **Typography reset**: title case for data, sentence-case labels, fewer weights, one text temperature, and military time and lb units per the approved spec.

---

## Would changing only CSS make SOLIS feel like a new generation?
**No.** CSS can fix color, weight, radius and the uppercase labels. It can't fix the three things that make SOLIS feel old:
- **Information order:** what is above the fold on Case Detail and the Dashboard.
- **Page architecture:** forms instead of workspaces, nested tabs, a catalog instead of a dashboard.
- **Component model:** card-per-section wrappers, inline selects mixed with read-only text, a raw activity feed, row-level button sprawl.

The structural changes needed:
- New shell components (sidebar, topbar, avatar menu, command search)
- Case Detail layout and stepper rewrite
- Edit-mode field groups
- A data table with a filter toolbar and saved views
- An activity-event presentation layer
- A Reports landing page that shows data

All of these keep existing functionality; the data, hooks and RBAC stay as they are.

---
*Audit only. Nothing was changed. Waiting for approval before any redesign work.*
