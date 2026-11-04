# Order recovery — interrupted order saves (2026-11)

Order versioning (docs/ORDER_VERSIONING.md, Phase 5A.2) fixes two Production
risks: simultaneous edits creating two active orders, and an interrupted save
leaving a case with no active order. The price of that safety is that an
interrupted save **locks the case order** until an administrator recovers it.
This document is the recovery procedure. Behaviour of the versioning itself is
unchanged.

## What staff see

| Order card says | Meaning | Who acts |
|---|---|---|
| "A change … is being saved. Editing and payments are paused" | A save is in progress (less than 5 minutes old). | Nobody — reload shortly. |
| "…was interrupted before it finished. The order is locked…" + "An administrator must recover this order" | The save stopped part way (server crash, timeout, lost connection) and is older than 5 minutes. The order shown is the version still billed. No edits, no payments. | An administrator. |
| Same, plus the **Order recovery — administrators** panel | You hold `organization.manage` + `caseOrder.update` (exactly what the repair API checks). | You. |

## Recovery from the case page (normal path)

1. Open the case › Billing › Case Order. The recovery panel lists the
   interrupted change for **this case only**: the case name and number, the
   change (version *n* → *n+1*, new total), when it started, the last step
   recorded, the change reference, the state of the new and previous versions,
   whether its revenue is posted, how many audit entries are missing, and
   **why recovery is needed** (the server's own reading of the rows and ledger).
2. Check the case's order history and payments.
3. Choose one of the repairs the server offers (only safe ones are shown):

| Action | What happens | When offered |
|---|---|---|
| Complete the change | The new version is put in effect (the previous one superseded if that never happened), its missing audit entries are written, its revenue is posted **only if the ledger shows it is not already posted**, the balance is recalculated from the payments on file. | New version saved but not in effect, or in effect but revenue/audit missing. |
| Roll back the change | The previous version is back in effect, the new one is `withdrawn` (kept in history). No revenue. | New version saved but never in effect. |
| Close | Nothing on the order changes; the journal records it closed by you with your note (required). | Nothing (more) to do, or someone changed the order since. |

4. Tick the confirmation and press **Confirm**. The order reloads unlocked.
   If the server refuses (another administrator just repaired it, or the state
   changed), the reason is shown and the panel reloads.

If the panel says **no repair is safe from SOLIS**, the ledger holds a
partially written entry or could not be read. Do not edit anything; have the
general ledger entry for that change reviewed by hand (reference
`case-order-revenue:<change reference>`), then retry or close.

## API fallback (if the case page is unavailable)

Same checks, same outcome. Session cookie of an administrator; same-origin POST.

```
GET  /api/cases/order-operations?organizationId=<org>[&caseId=<case>][&all=1]
POST /api/cases/order-operations/<operationId>
     { "organizationId": "<org>", "action": "complete" | "roll_back" | "close", "note": "…" }
```

Organizations that change service through the coordinated service change
(Gus) also have `GET/POST /api/cases/service-change-operations[/<id>]` for the
case half of an interrupted service change; its order half appears in the
report above.

## What never happens

- No payment, refund or settled amount is created, changed or deleted by any
  repair. Payments taken while the order was locked stay as recorded; the
  balance is simply recalculated.
- Revenue for a change is posted at most once (repairs check the ledger by
  reference and claim the order row first — two administrators confirming at
  the same moment get one repair and one "in progress" refusal).
- No new order version is created by a repair; nothing is repaired
  automatically; a resolved change is never repaired again (409).
- Nothing crosses organizations: another organization's change is "not
  found", and a non-member is refused (403).
- Non-administrators (Manager, Funeral Director, Office Staff…) are refused
  (403) by both routes, whatever the page shows.

## Audit trail

Every step is an append-only journal entry (`case.order.operation.journal`
activity events): `prepared` → `activated` → `completed` for a normal save,
and `resolved` (with the administrator, the resolution and the note) for a
repair. A completed repair also writes the change's own case order audit
entries exactly once.

## Manors walkthrough (automated, fictional data)

`services/manorsOrderWalkthrough.test.ts` runs Manors' real profile through
the real routes:

1. **Normal edit** — version 1 superseded, version 2 active; journal
   `prepared → activated → completed`. An edit without its version: 428.
2. **Concurrent edits** — an edit made against an old version: 409, nothing
   written; two saves of the same version at once: one 200, one 409, still
   exactly one active order.
3. **Existing pricing** — after a catalog price change, an edit re-prices the
   line at the current price (Manors' behaviour, unchanged); version 1 keeps
   its price.
4. **Interrupted save** — order locked (`order_needs_repair`), billing stays
   on version 1, edits refused.
5. **Recovery** — Manager and Funeral Director refused; Gus refused; another
   case's report empty; the administrator's report names the change and why;
   two simultaneous "complete" confirmations → one repair, revenue posted
   once, no extra version; a third attempt 409; journal `resolved` with the
   administrator and note; payments unchanged; editing works again. Roll
   back: previous version active, interrupted one withdrawn, no revenue.

Component tests: `components/case/OrderRecoveryPanel.test.tsx`,
`components/case/CaseOrderCard.test.tsx` (panel vs. notice). The Wix-level
crash-at-every-write simulation remains in
`app/api/cases/order-operations/route.wix.test.ts`.
