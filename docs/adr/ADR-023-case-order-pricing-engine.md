# ADR-023: Service Catalog, Case Order & Pricing Engine

**Status:** Accepted
**Date:** 2026-07-24

## Context

Phase 19B made payment *collection* real (Clover Hosted Checkout) but left payment *amounts* exactly as manual as they were before: a staff member typed an arbitrary dollar figure and purpose into `PaymentCard`, and Clover charged whatever they typed. There was no persisted record of what a family was actually being charged for, no connection between a case's services and its balance, and no way to answer "how much does Manor's Cremation charge for a 230 lb direct cremation with two extra death certificates?" except by asking a staff member to do the arithmetic themselves.

This phase replaces that manual amount with an itemized **Case Order** — a permanent, server-calculated record of the services a family requested, how the total was derived, and the remaining balance — and makes Beacon, never Clover and never the browser, the sole authority on price.

## Why a pricing engine, not inline arithmetic

Manor's Cremation's v1 price list (Direct Cremation $890; weight-tier surcharges; per-death-certificate and shipping add-ons) could have been hardcoded directly into `NewCaseModal`/`PaymentCard` as a handful of `if` statements. That was explicitly rejected by the phase's own "Future Proofing" requirement: a `serviceCatalog` collection holds every service/price/rule, and `domain/pricing/calculateOrder.ts` operates purely on *whatever the catalog contains* — a service code it doesn't recognize (a future organization's entirely different price list) is simply invisible to it, never a crash or a hardcoded fallback. The five Manor's-specific service code strings (`DIRECT_CREMATION`, `WEIGHT_SURCHARGE_201_250`, `WEIGHT_SURCHARGE_251_300`, `EXTRA_DEATH_CERTIFICATE`, `MAIL_CREMATED_REMAINS`) appear in exactly one place outside seed data — `domain/pricing/serviceCodes.ts` — used only to know which catalog row plays which *role* in the calculation (which one is the always-included base service, which two are the mutually-exclusive weight tiers), never to hardcode a price.

## Domain/service split (consistent with the project's existing architecture)

- **`domain/pricing/calculateOrder.ts`** — pure, side-effect-free arithmetic: catalog + selections → line items → totals → balance. No fetch, no organizationId, no I/O of any kind. `domain/pricing/auditDiff.ts` is the equivalent pure function for turning two selection snapshots into audit-trail entries.
- **`services/pricingService.ts`** — orchestration and persistence: fetches the catalog, calls the domain function, writes `CaseOrder`/`CaseOrderLineItem`/`CaseOrderAuditEntry` rows, and reuses `services/paymentsService.ts`'s `listPaymentRecordsForCase` to compute how much a case has actually been paid — never duplicating that lookup.

This mirrors the existing `domain/cases/*` vs. `services/casesService.ts` split exactly; nothing new was invented for this phase's own sake.

## Client preview vs. server authority (resolving an apparent tension)

The phase's own requirements contain what reads like a contradiction: "No pricing calculated in React" (a security requirement) alongside "Live Itemized Summary" — a running total shown as staff selects services, before a case even exists to recalculate against. The resolution: **`domain/pricing/calculateOrder.ts` is imported by both the browser and the server, but only the server's invocation is ever trusted.**

- `components/case/ServicesAndChargesSelector.tsx` (shared between `NewCaseModal` and `EditServicesModal`) calls `calculateOrderTotals` directly, client-side, purely to render the Live Itemized Summary instantly — zero network round-trip, real-time feedback as a radio/checkbox changes.
- The browser never submits that computed total anywhere. `POST`/`PATCH /api/cases/[caseId]/order` accept only a `ServiceSelections` object (`weightTier`, `extraDeathCertificateQuantity`, `mailCremated`) — there is no `total`/`amount`/`balanceDue` field in the request body type at all, so a forged one is not merely rejected, it's structurally inexpressible. The server independently re-fetches its own copy of the catalog (`getServiceCatalog`) and re-runs the identical pure function before persisting anything.

`services/pricingService.test.ts` and the order route's own tests include an explicit regression case: a request body with a tampered `total: 1, balanceDue: 1` alongside real selections is silently ignored — the persisted order reflects only the selections, never the forged figures.

## CaseOrder is append-only/versioned

Editing a case's services (add a death certificate, change the weight tier) never mutates the existing `CaseOrder` row. It:

1. Marks the current `active` row `superseded`.
2. Calculates a brand-new row (`version + 1`, `status: 'active'`) from the new selections.
3. Persists fresh `CaseOrderLineItem` rows for the new version (never editing the old version's line items).
4. Diffs the old and new selections (`domain/pricing/auditDiff.ts`) and appends one `CaseOrderAuditEntry` per actual change.

This is the same pattern already established for `WorkflowTemplateVersion` (Phase 11/18) — an append-only history is what makes "Never rewrite historical payments" true *structurally*, not just by convention: a `PaymentRecord.caseOrderId` always points at whichever version was active when that payment was initiated, and that version's own `total`/`subtotal` never change after the fact.

A no-op edit (submitted selections identical to the current order's) is detected via the same diff and produces **no** new version and **no** audit entries — an empty diff means nothing to record, and a version-history/audit-log entry for "nothing changed" would be noise, not history.

### The CaseOrder version invariant, stated explicitly

Reviewed and approved 2026-07-24. The guarantee above, stated as a standalone invariant (not just implied by the mechanism that produces it) so future work can be checked against it directly:

1. **A `CaseOrder` version, once superseded, is immutable.** No code path ever calls an update against a `superseded` row's `subtotal`/`discountTotal`/`taxTotal`/`total`/`version` — the only field ever written on an existing row is `status` (active→superseded, exactly once, at the moment it's replaced) and `balanceDue` (see point 4).
2. **Every edit creates a new version; none rewrites an old one.** `recalculateOrder` only ever inserts a new `CaseOrder`/`CaseOrderLineItem` set — `version` strictly increments, and the previous version's own line items are left untouched, never edited or deleted.
3. **A `PaymentRecord` stays attached to the specific version it was collected against.** `PaymentRecord.caseOrderId` is set once, at checkout-creation time, to whichever version was `active` at that moment, and never reassigned afterward — a payment's own historical record of "what this was for" never silently migrates to a later version.
4. **Balance is calculated across every succeeded payment for the case, not scoped to one version.** `getPaidAmountForCase` sums every `status: 'succeeded'` `PaymentRecord` for the `caseId`, independent of each payment's own `caseOrderId` — so a payment collected against v1 still reduces v2's (or v5's) `balanceDue`. This is the one field that *does* get updated on an otherwise-immutable active row (`refreshBalanceForCase`), and only ever in response to a real payment outcome, never as part of an edit.

## Balance calculation looks across every version, not just the current one

`CaseOrder.balanceDue` is `total` minus the sum of every `succeeded` `PaymentRecord` for the *case* (via `caseId`), regardless of which specific `CaseOrder` version each payment's own `caseOrderId` references. A family that pays a $500 deposit against v1 ($890 total), after which staff add a $50 death certificate (v2, $940 total), owes $440 — not $940 — because the deposit still counts. `services/pricingService.ts`'s `getPaidAmountForCase` is the one place this sum is computed, reused by both `createCaseOrder` (always 0 for a brand-new order) and `recalculateOrder`/`refreshBalanceForCase`.

## Payment integration reuses Phase 19B without duplicating pricing logic

`PaymentRecord` gained one field: `caseOrderId: string | null` (null only for pre-Phase-19C payments, which predate Case Orders entirely). `app/api/cases/[caseId]/payments/clover/checkout/route.ts` was corrected so **`amount` can no longer be supplied by the client at all** — the route rejects a request body containing an `amount` field outright (400), fetches the case's active `CaseOrder` server-side, and uses its `balanceDue` as the sole source of the charge. A case with no active order (422) or a $0 balance (400) cannot check out — there is nothing for Clover to collect. No pricing math was added to the checkout route or to `services/paymentsService.ts`; both simply consume `CaseOrder.balanceDue` as an opaque number.

`services/paymentWorkflow.ts`'s `markCasePaidIfVerified` — previously "any single verified payment means the case is fully paid," correct when amounts were always exactly what staff decided to collect — now checks the CaseOrder's own balance for a case that has one: it refreshes `balanceDue` (via `refreshBalanceForCase`) and only marks the case `paid_in_full` once that balance reaches 0, supporting a deposit-then-balance flow that Phase 19B's single-payment-means-paid model couldn't represent. A case with no CaseOrder (legacy data) keeps the original unconditional behavior, verified by Phase 19B's existing test suite passing unmodified against this change.

## Audit trail: a fourth collection beyond the phase's own three-collection list

The phase's own "New Wix Collections" instruction named exactly three: `serviceCatalog`, `caseOrders`, `caseOrderLineItems`. Its "Audit Trail" section separately requires tracking "user, timestamp, action, previous value, new value" — none of which has a field in any of those three collections' own listed schemas. A `caseOrderAuditEntries` collection (Collection 14) was added for this — the same judgment call, for the same reason, as Phase 19B's own `webhookEvents` addition beyond that phase's three-collection list (see ADR-022). Flagging it here for the same reason it was flagged there.

## Editing UI reuses the same selector as case creation

`components/case/ServicesAndChargesSelector.tsx` is one component used by both `NewCaseModal` (initial selection, defaults to the zero-cost "Under 200 lb, no add-ons" state) and `EditServicesModal` (prefilled from the current order's line items, reconstructed via `domain/pricing/calculateOrder.ts`'s `selectionsFromLineItems` — reversing "which service codes are present" back into a `ServiceSelections` object, since `CaseOrder` itself stores no raw-selections blob, only its resulting line items). `EditServicesModal` also serves a second purpose: a case with no active order at all (legacy data predating this phase, or a case whose initial order creation failed after case creation succeeded) can use the identical modal to create its first order via `POST` instead of `PATCH` — the only difference is which mutation hook fires, decided by whether an active order already exists.

## Never hardcode weight-tier "under 200 lb" as a $0 catalog row

Manor's price list has no service code for the under-200lb tier — "+$0" means nothing to itemize, not a zero-dollar line item to display. `ServicesAndChargesSelector` synthesizes the "Under 200 lb" radio option purely for the UI's mutually-exclusive tier selection (via `domain/pricing/calculateOrder.ts`'s `weightTierLabel`/`weightTierServiceCode`, which map that tier to `null`); no catalog row, no line item, no audit-entry price for it ever exists.

## Security

- **No pricing calculated in React** in the sense that matters: the browser's calculation is never trusted, only displayed (see "Client preview vs. server authority" above).
- **No browser-submitted totals trusted:** the order-creation/edit request bodies have no field for one.
- **No client-controlled discounts:** `calculateAdjustment`/`discountTotal`/`taxTotal` exist in the type/function surface (reserved for a future feature) but no UI in this phase produces a non-zero value, and nothing server-side would currently apply one from client input even if a caller tried — there is no discount field anywhere in `ServiceSelections`.
- **Server recalculates every order before persistence:** `createCaseOrder`/`recalculateOrder` both always re-fetch the catalog and re-run `calculateOrderTotals` themselves; neither ever accepts a pre-computed total as an argument.
- **Authorization remains organization-scoped:** every new Route Handler (`GET /api/service-catalog`, `GET`/`POST`/`PATCH /api/cases/[caseId]/order`) calls `requireAuthorizedOrganization` exactly like every existing Route Handler, and `services/pricingService.ts`'s every function takes an explicit `organizationId` and scopes every query/mutation to it — verified by dedicated cross-organization-isolation tests (a `CaseOrder` created for one organization is invisible to, and cannot be edited by, another organization even when both reference the identical `caseId` string).

## Consequences

- Case Orders become the reporting source of truth this phase's own "Reporting" section anticipates (Revenue, Services Sold, Weight Surcharges, Death Certificates, Shipping Revenue, Average Case Value) — building the actual report views is explicitly deferred, not part of this phase's deliverables, but the underlying data (itemized, versioned, per-organization) is now structured to support them without a further schema change.
- `components/case/PaymentCard.tsx` (Phase 19B) is fully retired, replaced by `components/case/CaseOrderCard.tsx` — the manual amount/purpose entry it offered is gone; "Collect Balance with Clover" always charges `CaseOrder.balanceDue`.
- A future percentage-based fee, tiered rate, or seasonal surcharge is addable by inserting new `serviceCatalog` rows (and, if it doesn't fit `flat`/`per_unit`, a new `pricingType`/`category` value `domain/pricing/calculateOrder.ts` learns to interpret) — never by hardcoding a new `if` branch in a component.
- **Architecture review note (2026-07-24, non-blocking):** today's catalog encodes each pricing *variation* as its own service row (`WEIGHT_SURCHARGE_201_250` and `WEIGHT_SURCHARGE_251_300` are two separate rows rather than one weight-surcharge rule with tiers). Reviewer recommendation for a future pricing-enhancement phase: evolve toward rule-based pricing (a tier/quantity/flat-fee *rule* attached to one service, rather than one row per variation) so a catalog with many tiers doesn't require a proportional number of rows. Not implemented here — Manor's five rows are simple enough that the current one-row-per-variation shape needed no such generalization yet, and building it speculatively ahead of a second organization actually needing it would be exactly the kind of unrequested abstraction this project's own build-only-what's-used discipline argues against.

## Alternatives considered

- **Storing a raw `selections` JSON blob on `CaseOrder` itself**, rather than reconstructing it from line items via `selectionsFromLineItems`. Rejected: it would duplicate the same information two ways (the line items already fully encode what was selected), and the phase's own `caseOrders` field list has no such field — adding one would be exactly the kind of unrequested schema addition this phase's "future-proofing without over-building" discipline argues against. Reconstructing from line items costs a small amount of domain logic in exchange for one less redundant, driftable field.
- **A single mutable `CaseOrder` row, with edits applied in place.** Rejected: it cannot satisfy "Never rewrite historical payments" — a `PaymentRecord.caseOrderId` would point at a row whose `total` had since changed underneath it, making "what was this payment actually for" unanswerable after any subsequent edit.
- **Percentage/manual discounts wired into this phase's UI.** Rejected as out of scope: nothing in the "New Case UI"/"Case Detail" mockups calls for a discount control, so none was built — `calculateAdjustment` exists as a tested, ready-to-call function for whenever that feature is actually requested.
