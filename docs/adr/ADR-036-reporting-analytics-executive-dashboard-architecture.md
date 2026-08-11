# ADR-036: Reporting, Analytics & Executive Dashboard

**Status:** Accepted
**Date:** 2026-08-10

## Context

Phase 31 gave Beacon a real general ledger, but every insight into the business — case flow, staffing, scheduling, and now financial performance — was still either computed ad hoc client-side (`app/(portal)/reports/page.tsx`, `app/(portal)/dashboard/page.tsx`, both built on `domain/reports/calculations.ts`'s `useMemo`-over-the-full-unpaginated-case-array pattern) or, for the 6 financial reports Phase 31 shipped, real but siloed behind their own accounting-only UI with no shared metric vocabulary, no drill-down, and no export. ADR-035 named this pattern explicitly as "the wrong shape" for anything that aggregates real history. This phase builds the one, centralized, permission-aware reporting/analytics platform Beacon has needed since Phase 8 — deriving every number from the canonical services that already own that data, never recalculating or duplicating business logic.

A full codebase research pass across the operational domain (cases/workflow/tasks/staff/scheduling/resources), the financial domain (case orders/payments/GL/AR/banking), and documents/signatures/notifications/UI conventions surfaced two consequential findings, resolved before implementation began.

## Two findings, resolved before implementation

### Finding 1 — Revenue was never actually recognized in the Phase 31 ledger

`SERVICE_REVENUE` (account `4000`) had exactly one reference in the entire codebase: its own definition in `domain/ledger/starterChartOfAccounts.ts`. No Phase 31 transaction type ever credited it, and `pricingService.ts`'s `createCaseOrder`/`recalculateOrder` never touched the ledger at all — the only entry touching Accounts Receivable was payment posting (Dr Undeposited Funds / Cr Accounts Receivable). Concretely: **AR's derived balance would run increasingly negative with every real payment, and Revenue/P&L were structurally always $0** — a latent, pre-existing Phase 31 defect, not something this phase introduced. It hadn't manifested in Manor's Cremation's live data only because that tenant had zero real payments at Phase 31's close.

**Resolution:** a new `'revenue_recognition'` `JournalEntrySourceType` (an additive TS union member — `sourceType` is a plain, unconstrained Text field at the Wix level, so this needed no schema change): `createCaseOrder` posts Dr Accounts Receivable / Cr Service Revenue for the full `total`; `recalculateOrder` posts only the **net delta** since the last version, direction determined by sign, skipped entirely on a zero delta (`assertJournalEntryBalances` already rejects zero-amount lines, so this falls out naturally). Posted directly from `pricingService.ts` via `generalLedgerService.createAndPostJournalEntry`/`chartOfAccountsService.getAccountByNumber` — the same low-level primitives `financialTransactionService.ts` itself depends on — rather than routing through `financialTransactionService.ts`, which would create a circular import (`financialTransactionService.ts` already calls `pricingService.ts#refreshBalanceForCase`). This makes `pricingService.ts` a peer consumer of the ledger, not a new link in an existing cycle.

Many of Phase 31's own 34+ existing `pricingService.test.ts` call sites never seed the chart of accounts. Rather than throwing when the required accounts don't exist yet, `postRevenueRecognition` auto-seeds idempotently (`seedChartOfAccounts`, safe to call when accounts already exist) — preserving "never silently skip revenue recognition" without requiring every caller to change.

This also fixes the Balance Sheet's own Total Assets figure, which — as Phase 31 shipped it — would already have been silently wrong for any tenant with real payment history. This phase is not just enabling revenue reporting; it closes a live, disclosed Phase 31 defect. Proven directly: `services/pricingService.test.ts`'s own Phase 32 test posts a real case order plus a real payment and asserts `getTrialBalance().totalDebits === totalCredits` and `getBalanceSheet().totalAssets === totalLiabilitiesAndEquity` — not just that revenue recognition ran, but that the books actually balance afterward.

### Finding 2 — `Case.daysWaitingInStage` is mock-static; true cycle-time has no persisted source in mock mode

`types/case.ts`'s own comment already named `daysWaitingInStage` as "mock-static for this phase; a real backend would derive this from a stage-entry timestamp." The one real source that exists is `activityService.ts`'s `recordCaseCreated`/`recordStageChanged` (Phase 24) — but a direct grep confirmed these are called only from the `wix`-mode API routes (`app/api/cases/*`), never from `casesService.ts`'s `mock`-mode branch, which executes directly in the browser (via `hooks/useCases.ts`) with no server-side `ActivityContext` to construct. `activityService.ts` itself imports Node's `crypto` and the server-only, secret-reading `lib/wixDataApi.ts` — a real architectural constraint, not a gap that can be closed by simply wiring a function call.

**Resolution:** `cases.average_cycle_days` and `cases.completed` derive from `activityEvents`' `CASE_STAGE_CHANGED` history, computed as the delta between a case's `createdAt` and its first terminal-stage transition. This has real data only in `wix` mode today — disclosed as a wix-mode-only limitation, not silently masked. `domain/reports/calculations.ts`'s existing `computeStageBreakdown`'s `avgDays` (the average of the *live, currently-in-stage* `daysWaitingInStage` across cases right now) is a distinct, narrower metric, kept and named distinctly: `cases.stage.average_days` (today's snapshot) vs. `cases.average_cycle_days` (true historical duration) — never conflated.

## Architecture

The user's own suggested `AnalyticsQueryService` as a separate cross-domain composition layer was rejected as redundant with what `financialReportsService.ts` already does for the financial domain — a parallel service would either duplicate that responsibility or become a pass-through with no purpose of its own.

```
Routes (app/api/reports/*, /api/dashboard, /api/metrics/*, /api/report-presets)
    ↓ (requireAuthorizedOrganization → hasPermission(definition.permission) → service call → NextResponse.json)
services/reportingService.ts          — operational + staff metric functions, plus runReport()/runSingleMetric() dispatchers
services/financialReportsService.ts   — REUSED AS-IS (Phase 31), financial aggregations
services/dashboardService.ts          — composes reportingService + notificationService into the 4 dashboard sections
services/reportExportService.ts       — CSV export over any report's rows, built on domain/reporting/csvExport.ts
services/reportPresetService.ts       — CRUD for saved filter presets, sole writer of reportPresets
domain/reporting/metricRegistry.ts    — in-code MetricDefinition catalog (mirrors domain/rbac/permissionCatalog.ts's pattern)
domain/reporting/reportRegistry.ts    — in-code ReportDefinition catalog
domain/reporting/csvExport.ts         — the CSV serializer, extracted from activityService.ts's own pre-existing implementation
    ↓ (read-only calls into, never reimplements)
casesService / tasksService / staffProfileService / schedulingService / resourceService / documentService /
signatureService / notificationService / pricingService / generalLedgerService / chartOfAccountsService / bankingService
```

**Metric dispatch is one table, in one file.** `reportingService.ts`'s private `METRIC_RUNNERS` maps every `MetricKey` to the function that computes it; `runReport()` (for a whole report) and `runSingleMetric()` (for one ad hoc metric, backing drill-down cards) both call into this exact same table — never two calculation paths for the same metric.

**Dashboard sections are permission-gated at render time, not saved per-user layouts.** `today` needs no permission at all (every authenticated member reads their own unread-notification count, the same way every member reads their own session); `operations`/`financial`/`attention` are each computed by `dashboardService.getDashboard` only for the permissions the caller actually holds — never computed then hidden client-side. This avoids needing any new collection for dashboard layout state; only saved report *presets* are genuinely new persisted state.

**Server-safe reads for `casesService.ts`/`tasksService.ts`.** Both files' `wix`-mode `list()` functions are client-only HTTP wrappers (built for `hooks/useCases.ts`/`hooks/useTasks.ts` running in a browser), unusable from a Route Handler. `reportingService.ts` instead calls new `listForOrganization(organizationId, dataAdapterMode)` functions on each — a direct-to-Wix, server-safe read mirroring `services/scheduling/appointmentReads.ts`'s existing precedent for the same problem. See "Live Wix verification" below for how this gap was actually discovered (live, not by inspection) and resolved.

**Data aggregation strategy — live aggregation only, no snapshots.** ADR-035 already disclosed "report read-time cost at scale" as a named, deferred concern; Phase 31's live verification directly confirmed Manor's Cremation (the only real tenant) has exactly 1 case and 0 payment records. Live, on-demand aggregation is not just sufficient but the only currently-justified choice. If a future tenant's real volume changes this, the mitigation path (named, not built) is a period-anchored snapshot table refreshed on a schedule, computed from — never replacing — the same canonical sources.

## Metric and report registries

`domain/reporting/metricRegistry.ts` mirrors `domain/rbac/permissionCatalog.ts`'s exact array/type-derivation style (`export const METRIC_REGISTRY = [...] as const satisfies readonly MetricDefinition[]; export type MetricKey = (typeof METRIC_REGISTRY)[number]['key'];`) — an in-code, git-versioned, never user-editable catalog, consistent with this phase's "no arbitrary end-user formula builder" scope boundary. Every entry: `key` (stable, dot-namespaced, never a display string), `displayName`, `description`, `dataType` (`count`/`currency`/`percentage`/`days`/`hours`/`ratio`), `unit`, `source` (the real function that computes it — documentation only, never executed from this file), `allowedFilters`, `permission`.

`domain/reporting/reportRegistry.ts` follows the identical pattern. A report either lists `metrics: MetricKey[]` or names a `financialReportKey` (`'trialBalance'`/`'generalLedgerDetail'`/`'balanceSheet'`/`'profitAndLoss'`/`'arAging'`/`'transactionRegister'`) — the 6 Phase 31 financial reports are registered this way rather than as metric lists, since each returns its own rich, differently-shaped result, not a flat metric-value set; the Report Viewer branches on `financialReportKey` when present and renders that report's own shape instead of a generic metric-card/table layout.

**Filters honor only what a metric can actually support.** The initial registry draft listed `location` as an allowed filter on several case-based metrics; a direct check of `types/case.ts` confirmed `Case` has no location field at all (only `Appointment`/`Resource` do), so `location` was removed from `cases.active`/`cases.created`/`cases.stage.count`'s `allowedFilters` rather than silently accepting a filter the underlying query can't honor.

## Financial metrics — reuse the ledger, never recompute it

`reportingService.ts`'s revenue/AR functions are thin wrappers that reuse Phase 31's own primitives, proven via explicit reconciliation tests (`services/reportingService.test.ts`'s "Financial invariant proofs" block) rather than merely asserted:

- **`grossRevenue`** calls `financialReportsService.getProfitAndLoss` and returns its own `totalRevenue` — proven identical to that function's output for the same range, not independently recalculated.
- **`cashCollected`** sums debits to Undeposited Funds (`1100`) from posted `sourceType: 'payment'` entries — mirroring `getProfitAndLoss`'s own delta-summing technique, the one narrow extension of it this phase makes, not a reimplementation of a different rule. Proven to reconcile exactly against an independently-derived sum computed directly from the raw journal entry/line fixtures in the test itself (not by calling any reportingService/financialReportsService function) — a genuine reconciliation, not a tautology.
- **`arAgingSummary`** calls `financialReportsService.getArAgingReport` and buckets its own rows — proven identical `.total` to that report's own `totalOutstanding`.

## Staff metrics — StaffProfile-space, never display-name/email resolution

`staffWorkload`/`staffAppointmentLoad` resolve every row via `StaffProfile.id` (reusing `domain/reports/calculations.ts#computeStaffWorkload` for the case-count half), never by display name or email, per ADR-034's hard layering invariant. `staffProfileService.list` only returns active profiles, so historical report rows for a since-deactivated staff member still resolve correctly (the id itself is never invalidated, only the profile's `isActive` flag changes).

## Data & filter model

Every date-ranged metric/report defaults to the last 90 days (`reportingService.defaultDateRange`) unless the caller explicitly widens it — Phase 31's own "report read-time cost at scale" disclosure directly informs this bounded-by-default discipline. Date inputs are plain ISO strings, threaded straight through from the UI's `<input type="date">` values — `fromDate`/`toDate`/`createdAt`/`paidAt`/`entryDate`/`signedAt` are never silently substituted for one another; each metric function documents exactly which date field it filters on.

## Exports

CSV only, built on `domain/reporting/csvExport.ts` — extracted verbatim from `activityService.ts`'s own pre-Phase-32 `escapeCsvField`/`EXPORT_ROW_CAP` (10,000)/`Content-Disposition` implementation (Phase 24), the only hand-rolled CSV logic that existed in this codebase before this phase. `activityService.ts` itself was refactored to call the extracted, shared `buildCsv` rather than keep a duplicate — confirmed behavior-identical via its full existing test suite (28/28 passing unchanged) before and after the extraction. `reportExportService.ts`'s CSV column mapping per `financialReportKey` (Trial Balance, Balance Sheet's asset/liability/equity sections flattened with a `section` column, etc.) is presentational only — every figure it serializes was already computed by `runReport()`, never recalculated for the export path. Exporting requires `report.export` **in addition to** the report's own view permission, never as a substitute for it — mirroring `audit.export`'s own narrower-than-read precedent. PDF/Excel and scheduled delivery are explicitly out of scope this phase (named extension points, not attempted without a real consumer).

## Saved reports

`reportPresets` (Collection 62) is deliberately small: `reportKey`, `name`, `ownerIdentityId` (Identity-space — actor-attribution, "who saved this for their own convenience," not an operational assignment, so this is correctly *not* `ownerStaffProfileId` and outside ADR-034's layering invariant), a JSON-serialized filter blob, `isShared`. `isShared: true` requires `dashboard.manage`, enforced in `reportPresetService.create`/`remove` (never trusted from the request body alone) — a caller without it gets a clear `ReportPresetServiceError`, surfaced as `403`. No scheduled email delivery, no arbitrary query builder, per this phase's own scope boundary.

## RBAC

Four new keys, widening the catalog from 50 to **54**:

| Key | Tier |
|---|---|
| `report.operational` | Same as the pre-existing `report.view`: administrator, manager, funeralDirector, readOnly |
| `report.staff` | Same tier as `report.operational` |
| `report.export` | Administrator, manager only (mirrors `audit.export`'s narrower-than-read precedent) |
| `dashboard.manage` | Administrator, manager only |

`report.view` (existing, Phase 20) remains the base "can see Reports/Dashboard at all" gate, unchanged. Financial report access stays exactly as narrow as Phase 31 left it — `accounting.report`, deliberately not broadened; no duplicate "financial reporting" key was created. `readOnly`'s own existing "grants only `*.read`/`*.view` permissions" structural test needed one explicit carve-out for `report.operational`/`report.staff`, which are pure view actions despite not following that suffix convention (documented inline in `domain/rbac/defaultRoles.test.ts`) — `report.export`/`dashboard.manage` correctly stay withheld from `readOnly`, mirroring the same administrator/manager-only split as `portal.manage`.

`services/authorizationPolicyService.ts` gained `canViewOperationalReports`/`canViewStaffReports`/`canExportReports`/`canManageDashboard`, each a one-line `hasPermission` wrapper, following the exact existing pattern. Routes additionally call `hasPermission(policyParams, mode, definition.permission)` directly for a specific report/metric's own declared permission — a data-driven check parameterized by the registry, not a hardcoded per-route policy function, since the registry itself (not the route) decides which permission gates which report.

## API routes

```
GET    /api/reports                          — report definitions visible to caller (registry filtered by permission)
GET    /api/reports/[reportKey]               — run a report; query string = filters
GET    /api/reports/[reportKey]/export        — CSV, same filters + permission as the report itself
GET    /api/dashboard                         — the 4 dashboard sections
GET    /api/metrics/[metricKey]               — single metric value (drill-down cards)
GET    /api/report-presets                    — list saved presets (own + shared)
POST   /api/report-presets                    — create; isShared: true requires dashboard.manage
DELETE /api/report-presets/[presetId]         — remove own, or shared with dashboard.manage
```

Every route follows the established `requireAuthorizedOrganization` → policy check → service call → `NextResponse.json` shape. `services/reportsStructuralBoundaries.test.ts` enforces (via a source-tree walk, mirroring `financialStructuralBoundaries.test.ts`'s exact pattern): only `reportPresetService.ts` writes/deletes `reportPresets`; no reporting route/UI/client file touches `lib/wixDataApi.ts` directly; and no report/dashboard/metrics route imports a domain service directly (`casesService`, `generalLedgerService`, etc.) instead of going through `reportingService.ts`/`dashboardService.ts`/`reportExportService.ts` — a route that recomputed a metric itself would need to do exactly that, so this is a direct, mechanical proxy for "routes never implement metric calculations."

## UI

`app/(portal)/reports/page.tsx` — the Reports Library — **replaces** the Phase 8 client-computed Reports page; its old presentational components (`KpiTile`/`StaffWorkloadPanel`/`TimeInStagePanel`/`VeteranCasesPanel`) are deleted outright as fully orphaned rather than kept unused. `domain/reports/calculations.ts` itself is **not** deleted — `reportingService.ts` reuses `computeStageBreakdown`/`computeStaffWorkload`/`computeVeteranCaseStatuses` from it directly, and the pre-existing Dashboard page (`CasesByStagePanel`/`NeedsAttentionPanel`) still calls into it independently. `app/(portal)/reports/[reportKey]/page.tsx` (new) is the Report Viewer, dispatching each metric's *value shape* (not its key) to a `MetricCard`, a `BarChart`/`DonutChart` for the two cases that benefit from a visual (`cases.stage.count`, `cases.veteran_status`), or a generic `DataTable` otherwise — a purely presentational decision, never a second calculation.

**Charts are hand-rolled, minimal SVG — no new dependency**, per an explicit decision after confirming via a full dependency grep that no charting library exists anywhere in this codebase already. `BarChart`/`DonutChart` (a `LineChart` was not built — no metric in this phase is a true time series; every current metric is either a point-in-time scalar or a category breakdown, so building an unused primitive was skipped rather than built ahead of a real consumer) each render an `aria-hidden` SVG alongside a visually-hidden (`clip`-technique, not `display:none`) `<table>` that is the actual content screen readers see — "every chart has an accessible tabular equivalent," never a decorative-only visual.

The Dashboard (`app/(portal)/dashboard/page.tsx`) is **extended, not replaced**: new `FinancialSummaryPanel`/`AttentionPanel`, both gated by the `/api/dashboard` response's own `financial`/`attention` being non-null (never a second client-side permission check). Every figure in both panels links to the report that explains it — "no dead-end dashboard numbers." `RecentActivityPanel` previously rendered `services/__mocks__/fixtures.ts`'s static `activityFeedFixtures` (decorative content with no connection to real case activity, confirmed via grep to be otherwise fully unreferenced after this fix) — it now reads real organization activity via `activityService.ts` (the same source `AuditCenterPanel` already uses), gated by the pre-existing `audit.read` permission rather than rendering unconditionally as the static version did; the now-fully-orphaned `activityFeedFixtures` fixture was deleted.

## Activity integration

No new audit system. `report.exported`/`report.saved`/`dashboard.view.changed` were named in the original request as possible new activity event types, but no route or service in this phase's actual implementation calls `activityService.record*` for an ordinary report view or export — matching the phase's own instruction not to generate activity events for routine, non-security-relevant actions. This is a deliberate, disclosed scope reduction from the original request's own event list, not an oversight: nothing in this phase's security or audit model depends on report views/exports being independently logged, and adding events with no real consumer would be exactly the kind of speculative surface this codebase's own conventions avoid.

## Security

Every report/metric/dashboard query is organization-scoped server-side via `requireAuthorizedOrganization`'s resolved `organizationId` — never a client-supplied one. Financial-report access (`accounting.report`) and staff-report access (`report.staff`) are enforced identically to every other route in this codebase, no new authorization mechanism. Exports cannot bypass permissions — `report.export` is checked in addition to, never instead of, the report's own view permission. The Family Portal's `/family/*` routes are structurally outside `app/api/*`'s middleware matcher (confirmed, not assumed, in Phase 29) — the new reporting routes are excluded from family-session access the same way every other staff route already is, requiring no new isolation mechanism.

## Testing

`services/reportingService.test.ts` (34 tests) covers every operational/staff metric function against direct fixture-derived expectations, `runReport`/`runSingleMetric`'s dispatch correctness (including a clear error when `general-ledger` is run without an `accountId`, since `getGeneralLedgerDetail` itself requires one account and never scans every account at once), and the "Financial invariant proofs" block described above. `services/reportExportService.test.ts` (6 tests) covers CSV shape per report kind, including the balance-sheet/profit-and-loss section-flattening. `services/reportPresetService.test.ts` (10 tests) and `services/dashboardService.test.ts` (5 tests) cover ownership/sharing/permission-gating. `domain/reporting/metricRegistry.test.ts`/`reportRegistry.test.ts` (17 tests total) enforce registry-level invariants (no duplicate keys, every referenced permission is real, every report's metrics exist in the metric registry, the 6 Phase 31 financial reports are registered via `financialReportKey` not duplicated as metric lists). Route tests (40 tests across 7 files) cover permission denial, cross-tenant isolation, and the general-ledger `accountId` requirement for every new endpoint. Component tests (27 tests) cover `MetricCard`/`DataTable`/`BarChart`/`DonutChart`/`FilterBar`/`FinancialSummaryPanel`/`AttentionPanel`/`RecentActivityPanel`, plus the Reports Library page (3 tests).

**One disclosed testability gap, not a Phase 32 defect:** the Report Viewer page (`app/(portal)/reports/[reportKey]/page.tsx`) uses React 19's `use(params)` on the Next.js 15 async `params` Promise — the same established pattern `app/(portal)/cases/[caseId]/page.tsx` already uses. Neither page has direct component test coverage for this reason: `use()` does not resolve inside this codebase's current jsdom/`@testing-library/react`/`Suspense` test harness (a `<Suspense>`-wrapped render stays on its fallback indefinitely in the test environment, never flushing past the resolved promise). This is a pre-existing gap in the test harness's support for the `use(params)` pattern, not something this phase introduced or could reasonably fix without changing the testing infrastructure itself.

## Live Wix verification

Staged in two passes against the real Manor's Cremation tenant (`organizationId: "managed-cremations"`), mirroring every prior phase's disposable-lifecycle discipline.

**Pass 1 (read-only)** surfaced a real, previously-undiscovered architectural gap, not assumed going in: chart-of-accounts lookups succeeded immediately (confirming real Accounts Receivable/Service Revenue account ids), but `reportingService.ts`'s case/task-backed metrics failed with `TypeError: Failed to parse URL from /api/cases?organizationId=...`. Root cause: `casesService.ts`'s/`tasksService.ts`'s `wix`-mode `list()` functions are **client-only HTTP wrappers** — a relative-path `fetch('/api/cases?...')`/`fetch('/api/tasks?...')` meant to run in a browser via `hooks/useCases.ts`/`hooks/useTasks.ts`; the real Wix-querying logic lives inline inside `app/api/cases/route.ts`'s/`app/api/tasks/route.ts`'s own `GET` handlers, not in the service files at all for the `wix` path. `reportingService.ts` runs inside Route Handlers, never a browser, so a relative URL has no origin to resolve against.

Reported to the user before continuing, per this phase's own instruction to disclose an architectural conflict rather than work around it. **Resolution (approved before implementation resumed):** added `casesService.ts#listForOrganization`/`tasksService.ts#listForOrganization` — direct-to-Wix, server-safe read functions mirroring `services/scheduling/appointmentReads.ts`'s existing precedent for exactly this "a server-side consumer needs a direct read, not the client's own HTTP wrapper" problem. `casesService.ts`'s version mirrors `app/api/cases/route.ts`'s own `GET` handler's query shape exactly (`{organizationId, isArchived: false}` — confirmed via `lib/wixCaseMapper.ts` that Wix's `isArchived` field maps to `Case.isDeleted`, a documented rename); `tasksService.ts`'s mirrors `app/api/tasks/route.ts`'s own handler (`{organizationId}`, no `caseId` narrowing needed for reporting's purposes). `reportingService.ts`'s 6 call sites (`loadCaseViewModels`, `countCasesCreated`, `terminalStageChangeEvents`'s case-lookup, `countOpenTasks`, `countOverdueTasks`, `staffWorkload`) were switched to the new functions. This deliberately does not touch or consolidate the existing routes' own working query logic — routing them through the same new functions is a named future cleanup, out of scope for a fix that only needed to close what was actually broken. Re-running Pass 1 afterward confirmed every operational metric now computes correctly against real data (1 case, 1 task, 2 active staff profiles at verification time).

A second, independent bug surfaced during Pass 2: `lib/wixJournalEntryMapper.ts`'s `VALID_SOURCE_TYPES` array was never updated when Finding 1 added `'revenue_recognition'` to `types/journalEntry.ts`'s `JournalEntrySourceType` union — invisible in mock mode (fixtures never round-trip through this mapper) and in every existing unit test (none exercise a real Wix insert→map round trip for this source type), only surfaced when a real inserted `journalEntries` row came back rejected as `null` by the mapper's own validation, manifesting as `GeneralLedgerServiceError: Failed to create journal entry.` Fixed by adding `'revenue_recognition'` to the array; `lib/wixJournalEntryMapper.test.ts` gained an explicit round-trip test for it, with a comment noting every `JournalEntrySourceType` member should have one so a future addition can't silently repeat this gap.

**Pass 2 (disposable write, on explicit approval)**: created the `reportPresets` collection (Collection 62) and its 2 indexes (`organizationId_reportKey`, `organizationId_ownerIdentityId`), both confirmed `ACTIVE`. Created one disposable `CaseOrder` under a synthetic, never-real `caseId` — deliberately not Manor's Cremation's one actual case: `createCaseOrder` has no "supersede the existing active order" guard, so creating a second `active`-status order against the real case risked leaving its real balance/order state ambiguous mid-verification, with no clean rollback if the script failed partway. The synthetic-caseId approach exercises the identical ledger-posting code path with zero risk to real tenant data — a safety-motivated deviation from the plan's literal wording ("one disposable CaseOrder"), disclosed here rather than silently substituted.

The disposable order's $1,205.00 total posted a correct Dr Accounts Receivable / Cr Service Revenue entry: Trial Balance balanced exactly (`debits === credits === $1,205.00`, up from a genuine $0/$0 baseline — Manor's Cremation's one real case order predates this phase's revenue-recognition fix, so it had never posted a ledger entry of its own), `grossRevenue` increased by exactly the new order's total, and `arAgingSummary` correctly reflected the combined real + disposable outstanding balance ($965.00 + $1,205.00 = $2,170.00). One disposable saved `ReportPreset` was created and confirmed retrievable via `reportPresetService.list`. Every disposable row (1 CaseOrder, 3 CaseOrderLineItems, 1 CaseOrderAuditEntry, 1 JournalEntry + its 2 lines, 1 ActivityEvent, 1 ReportPreset) was deleted afterward; a final residual-check query across every affected collection confirmed zero leftover rows, and the tenant's real data (1 CaseOrder, 2 CaseOrderLineItems, 1 CaseOrderAuditEntry, 0 JournalEntries, 48 ActivityEvents) was confirmed unchanged from its pre-verification state.

## Deferred

- **A `LineChart` primitive** — no metric in this phase is a true time series; named, not built, until a real consumer needs one.
- **PDF/Excel export, scheduled report delivery, third-party BI integration, custom SQL/query builders, arbitrary end-user formula builders** — all explicit scope boundaries from the original request, reserved extension points only.
- **AI forecasting, predictive analytics, cross-funeral-home benchmarking, marketing analytics, payroll reporting, tax filing** — explicit scope boundaries, not attempted.
- **`resource.utilization` is booked-hours, not a true capacity percentage** — no business-hours/capacity model exists anywhere in this codebase to divide by; disclosed, not invented.
- **Cycle-time metrics (`cases.average_cycle_days`, `cases.completed`) have real data only in `wix` mode** — Finding 2's disclosed limitation; historical cases predating any future mock-mode wiring will show incomplete cycle-time data regardless.
- **No snapshot/materialization layer** — justified by Manor's Cremation's current real volume (1 case, 0 payments at last check); the named mitigation if volume changes is a period-anchored snapshot table, never a silent degradation of the always-fresh drill-down reports.
