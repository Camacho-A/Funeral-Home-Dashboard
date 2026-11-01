# Case order versioning — non-destructive (2026-10)

Shared code: this applies to every organization on the Beacon backend.

## The problem it fixes

A case's pricing record (`caseOrders`) is append-only: an edit inserts a new
version and marks the previous one `superseded`. Until 2026-10 the "mark
superseded" step of an ordinary edit (`recalculateOrder`: Edit Services,
merchandise add/return) read the previous row and wrote the **whole row back**
(`updateWixDataItem`, a full replace). Any write that landed between that read
and that write (a balance refresh after a payment, a concurrent edit) was
silently undone, and nothing stopped two edits made against the same version
from both "succeeding" — leaving two active versions, or one edit silently
replacing another.

## The design

| Property | How |
|---|---|
| History is never rewritten | A superseded version keeps its totals, line items, audit entries and every payment/invoice reference. Superseding is ONE field-scoped `PatchDataItem`: `status`, `supersededAt`, `supersededByOrderId`, `updatedAt` — nothing else is sent. No `caseOrders` row is written with a full replace anywhere (`lib/wixCaseOrderMapper.ts` no longer has a full-row merge helper). |
| One path for every order write | `createCaseOrder` and `recalculateOrder` both go through `commitPreparedCaseOrderChange` — the path the coordinated service change already used. Since Phase 5A.2 the write order is: journal `prepared` → new line items → the new version **`pending`** → compare-and-swap the previous version `active → superseded` → compare-and-swap the new version `pending → active` → audit entries → revenue recognition (see "Interrupted order changes" below). A failure part-way is compensated by **appending** (a restoring version / a reversing journal entry) or by withdrawing a version that never took effect, never by deleting. |
| Exactly one successor per version | The supersede is conditioned on `organizationId`, `beaconCaseOrderId` and `status = 'active'`. Only one request can flip a given version; the loser gets HTTP 428 (live-verified behavior of a conditional patch, single item — see `docs/CASE_CONCURRENCY.md` §1) and writes no order row, no audit entry, no revenue. |
| Staff edits are pinned | `PATCH /api/cases/[caseId]/order` and `POST /api/cases/[caseId]/merchandise` **require** `expectedOrderId` — the version the form was loaded from. Missing → **428** `order_version_required` (never treated as permission to replace whatever is active). Stale → **409** `order_conflict` with the current order (and, for the order route, its lines); nothing written. The merchandise route checks this before touching any reservation. Edit Services shows: *"These services were changed by someone else while you were editing. Nothing was saved. The latest services are now shown — make your change again and save."* |
| Server-derived edits retry, bounded | The merchandise **return** recomputes the remaining merchandise from the active version on every attempt and pins the recalculation to it; another edit landing in between means recompute — at most `ORDER_CHANGE_MAX_ATTEMPTS` (3), then 409. `recalculateOrder` without `expectedOrderId` (internal/test callers with absolute selections) re-prepares from the new active version, same bound. |
| Retries never duplicate | A retry of an edit that already landed is either refused (still pinned to the old version → 409, nothing written) or, pinned to the new version with the same selections, a no-op (`unchanged`: no version, no audit entry, no revenue). |
| First-order creation races | There is no previous version to compare-and-swap, so after inserting, a creation checks for any *other* active row for the case; if one exists it withdraws itself (CAS its own row to `superseded`) **before** writing any audit entry or revenue, and reports a conflict (409). Two creations checking at the same instant both withdraw — staff retry — so two active orders never stand. |
| Unambiguous active version | `getActiveCaseOrder` reads every active row of the case (up to 50, never `limit 1`) and picks deterministically: highest `version`, then earliest `createdAt`, then lowest id. More than one active row is logged (ids only). `listActiveCaseOrdersForOrganization` (AR aging, reports) returns at most one row per case by the same rule. |
| Version numbers stay unique | A new order for a case whose versions are all superseded continues the numbering (max + 1) instead of starting a second "version 1". |
| Organization isolation | Every read is filtered by `organizationId` (and re-checked after mapping); every patch is conditioned on it. |

### Why not deterministic ids per version

Considered (e.g. `${caseId}-v${n}` so a duplicate insert fails). Not adopted:
the compare-and-swap on the predecessor already guarantees one successor per
version, creation races are handled above, and deterministic ids would change
the id contract that payments, invoices, inventory reservations, the service
change journal (which records the planned order id before it is written) and
many tests rely on. Ids stay `crypto.randomUUID()`.

## Payments, invoices, accounting

- A payment's `caseOrderId` still points at the version that was active when it
  was made; that version's totals never change afterwards.
- `balanceDue` of a new version still nets out every succeeded payment for the
  case across all versions (and write-offs on refresh), as before.
- Revenue recognition posts only the net delta per version, as before; a
  refused/withdrawn attempt posts nothing.

## Schema

**Required changes: none.** `supersededAt` (Date/ISO text),
`supersededByOrderId` (Text), and since Phase 5A.2 `supersedesOrderId` (Text)
and `repairClaimedAt` (Number, epoch ms) are optional new fields on
`caseOrders`; `status` gains the values `pending` and `withdrawn`. Journal
entries' existing `sourceReferenceId` now also carries the order operation's
revenue reference. Wix Data
stores undeclared fields, so they work without a schema change; declaring them
(not required) in the CMS is recommended so they appear in the dashboard. Rows
written before 2026-10 simply don't have them. Nothing was changed in the live
schema.

## Verification status

- **Simulated** (in-memory Wix stand-in honoring conditional patches and
  fixed-id inserts): `services/pricingServiceOrderVersioning.test.ts`,
  `app/api/cases/[caseId]/order/route.test.ts`,
  `app/api/cases/[caseId]/merchandise/route.test.ts`,
  `components/case/EditServicesModal.test.tsx`.
- **Live Wix**: not run. The behavior relied on — a single-item conditional
  patch returning 428 when its filter no longer matches — was live-verified
  earlier for single-field patches; the supersede patch sets four fields, so
  it falls under the not-yet-executed multi-field check in
  `docs/WIX_LIVE_VERIFICATION_PLAN.md`.

## Interrupted order changes (Phase 5A.2)

### What the audit found (before 5A.2)

Every order change wrote, in order: line items → previous version
`active → superseded` → new version inserted `active` → audit entries →
revenue. The live request undid its own failures, but a **process crash**
(deploy, timeout, out-of-memory) left:

| Crash after… | State left | Consequence |
|---|---|---|
| line items | orphan lines, nothing visible | harmless |
| previous version superseded | **no active order** | Order card showed "No case order yet" and offered **Set Up Services & Charges** → a fresh order whose whole total was recognized as revenue **again**; AR aging / reports dropped the case (as if $0 owed); manual payment refused ("no case order yet"); a payment webhook marked the case **paid** without checking a balance |
| new version inserted | new version active, its audit entries and revenue never written | ledger short by the change's delta, silently |
| audit entries | revenue never posted | ledger short, silently |
| revenue entry header (before its lines) | an empty or unbalanced ledger entry | AR / revenue misstated |

Only the order half of a **service change** was journaled (its own
`case.service_change.journal`), and even that repair offered only "close"
in the no-active-order state. Plain edits, merchandise add/return and
compensations were not journaled at all.

### The fix

| Property | How |
|---|---|
| Durable record before any write | Every order change (create, edit, merchandise add/return, service change, the restoring version of a compensation, the withdrawal of a first order) writes a `case.order.operation.journal` activity event **`prepared`** — with the plan: previous/planned order ids and versions, revenue deltas, the revenue reference, the audit entries with their ids — **before its first row write**. If it can't be recorded, the change is refused (503 `journal_unavailable`) and nothing is written. Then `activated` and `completed` (or `abandoned` / `compensated` / `failed`), best-effort. `services/orderOperationJournal.ts`. |
| Never zero or two active versions visible | The new version is inserted **`pending`** (never billed, never listed as a version) before the previous one is superseded, and activated last by compare-and-swap. A first-order race is still detected after activation and the loser withdrawn. |
| Billing stays deterministic while unfinished | `getCaseOrderState` → `effective`: the active version, or — in the window after the previous version was superseded and before the new one is active — that superseded version, flagged `operationInterrupted`. It is what the ledger still reflects (the new version's revenue is posted only after activation). The order card, invoices / document merge, AR aging and reports use it: a case never shows "no order" or $0 owed because of an unfinished change. |
| The case's order is LOCKED while a `pending` row exists | Creating, editing, merchandise add/return and service changes → **409** `order_needs_repair` (older than 5 minutes) or `order_busy` (in flight — retry). Manual payment and family checkout are refused. A payment that settles meanwhile (webhook) is **recorded**, but the case is not marked paid until the repair. Nothing ever creates a fresh order over an unfinished one. |
| Revenue is verifiable from the ledger | Revenue entries now carry the operation's reference as `sourceReferenceId` (`case-order-revenue:{orderId}`, `case-order-withdraw:{orderId}`). `getOrderRevenueState` sums every entry under the reference per account (AR, 4000, 4100) and compares with the plan: `posted`, `not_posted` (no entry, or an empty header) or `partial`. A repair never guesses. |
| Administrator report and repair | `GET /api/cases/order-operations?organizationId=…[&all=1]` — read-only, admin-tier + `caseOrder.update`, own organization only: every interrupted operation with its plan and an inspection of the rows and ledger as they are now. `POST /api/cases/order-operations/{operationId}` `{organizationId, action, note?}`: **complete** (activate the planned version — superseding the previous one if that never happened — write the missing audit entries by id, post the revenue only if the ledger shows none of it, finish a revenue entry cut off between its lines only after verifying its stored lines are exactly what it was meant to post, refresh the balance, mark the case paid if payments taken meanwhile settled it); **roll_back** (only while the planned version is still pending: previous version active again, pending one `withdrawn`; no revenue exists then); **close** (nothing more to do). Each action is offered only when the current state makes it safe; refused otherwise. One repair at a time per operation (`repairClaimedAt` claim on the order row, 2-minute expiry), so revenue can't be posted twice by two administrators. Every action is journaled `resolved` with the administrator. A resolved operation is never repaired again. No UI yet — API only, like the service-change repair. |
| Service-change repair defers to it | While the case's order has an unfinished operation, the service-change report offers no action and points at the order-operations report. Service-change `compensate` can now use the ledger reference instead of refusing as "revenue unknown" (only for operations that have an order-operation journal). |

### Crash points tested (simulated)

`app/api/cases/order-operations/route.wix.test.ts` runs a real order edit
through the order route against the in-memory Wix stand-in and injects a
crash **before every one of its Wix writes in turn** (journal, line items,
pending insert, supersede, activate, journal, audit entries, ledger entry,
each ledger line, activity events): after each, never two active versions;
the previous version's totals and lines untouched; the case never shown
without an order; while a pending row exists, edit / create / payment are
refused and AR still counts the case (flagged); the report lists the
operation and the offered repair brings the case to exactly one active
version with the ledger's AR equal to its total; repeating the repair is
refused and writes nothing. Also: complete vs roll_back, two administrators
completing at once, payments taken during the interruption, a tampered
partial ledger entry (refused), a compensation interrupted while activating
its restoring version, access and organization isolation. Mock mode:
`services/orderOperation.mock.test.ts`.

## Remaining limits

- **Live Wix not verified** for any of this (see Verification status).
- **No transactions**: an unfinished change is now always *found and
  repairable*, but repair is a human step; until then the case's order is
  locked (payments too). The lock clears only by repair (or by the change
  finishing).
- **A ledger entry cut off between its lines whose stored lines no longer
  match its plan**, or a `partial` revenue state on a version that is not in
  effect, is refused — it needs review in the general ledger by hand.
- **Journal entries after `prepared` are best-effort**: a crash can leave
  the journal behind the rows (e.g. still `prepared` though complete); the
  inspection always reads the rows and ledger, and then offers only
  `close`.
- **Activity events** (`case.order.changed`) are still separate inserts and
  can be lost in a crash (the journal and the order audit entries are not).
- **Pre-5A.2 revenue entries** carry no reference: for operations made
  before this change the ledger can't be matched to an operation.
- **Writers outside SOLIS** (Wix dashboard edits) are not detected.
- **Older deployments** (e.g. Manors' current code) map `pending` and
  `withdrawn` rows as invalid and ignore them — safe (they never bill them)
  — but they don't honour the lock.
