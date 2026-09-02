# ADR-043 — Family Billing & FTC Compliance Documents (Phase 39)

Status: Accepted · Builds on ADR-029 (Document Generation, Phase 25), ADR-030-ish signatures (Phase 26), the Family Portal (Phase 29), and the pricing/order engine (Phase 19C/35).

## Context

Beacon had a complete pricing/order/payment/GL back-office but **no customer-facing billing document**. The FTC Funeral Rule (16 CFR Part 453) requires funeral providers to furnish specific itemized documents. Phase 39 delivers the two that matter for a direct-cremation provider — the **General Price List** and the **Statement of Funeral Goods and Services Selected** — generated from existing data and delivered/signed through existing machinery. Sales tax remains out of scope (Phase 37); no new GL semantics are introduced. See `docs/COMPLIANCE_BOUNDARY.md` for the legal boundary.

## Decisions

### 1. Deterministic system-rendered compliance documents, not org-authored templates (D1/D2)
The FTC documents are rendered **deterministically from authoritative snapshot data** by pure builders (`domain/billing/renderStatementHtml.ts`, `renderGeneralPriceListHtml.ts`), NOT via the Phase 25 template-merge path. Two reasons: the merge engine is intentionally non-Turing-complete (no loops) and cannot itemize; and FTC content is legally mandated and must not be free-form-authored per org. The render/store boundary is preserved: a new `documentService.generateBillingDocument()` / `renderAndStorePdf()` route the pre-built HTML through the SAME puppeteer→Blob pipeline, so `documentService` remains the only importer of the renderer/storage (structural test enforced).

### 2. System-locked FTC content registry (D6, mandatory-content architecture)
`domain/billing/ftcComplianceRegistry.ts` is the single source of truth for the **mandatory federal disclosure text** (versioned via `FTC_DISCLOSURE_VERSION`, each entry citation-tagged), the **mandatory structural sections**, and the **FTC classification keys**. Organizations cannot edit or remove mandatory wording; they may add clearly-separated **optional supplemental** language (`billingSupplementalConfigs`) that never replaces or qualifies a required disclosure. Conditional disclosures render only when the provider's actual offerings indicate the category applies (D7) — a direct-cremation-only provider never implies it sells caskets, outer burial containers, or embalming.

### 3. FTC classification (D3)
`domain/billing/ftcClassification.ts` maps catalog/merchandise items to machine-readable FTC classes (`basic_services_fee` / `goods_and_services` / `cash_advance` / `unclassified`). Precedence: a valid explicit `ServiceCatalogItem.ftcClass` override (additive nullable field) wins; else the category default; else `unclassified` — never a silently-fabricated compliance meaning (unclassified lines are surfaced distinctly in the render). D10: the direct-cremation `base` line is classified as the basic-services-fee-bearing line, and the documents state the fee is **included** in that price rather than charged twice.

### 4. Cash advances: display-only, hard-walled from AR (D4)
Cash-advance items (`caseCashAdvanceItems`) are DISPLAY-ONLY FTC data — never posted to the GL, AR, `CaseOrder` balance, `PaymentService`, or reporting (structural test enforced: `cashAdvanceService` imports no accounting writer). Each item carries a good-faith **estimate** flag and a **markup** flag. The Statement shows the FTC "total cost of arrangements" (goods/services + cash advances) and the **authoritative account balance** (amount owed to the provider, cash advances excluded) as **distinct, explicitly-labeled** figures, with a note that cash advances are billed/settled separately. GL-posted cash advances (with a clearing account) are deferred.

### 5. Historical snapshot provenance (mandatory-content architecture)
A compliance document is never re-derived from today's mutable catalog. The rendered PDF bytes + checksum are the durable snapshot; the Statement records the exact `CaseOrder.version` and disclosure version; the GPL (`orgDocuments`, D5) records effective date, disclosure version, and a `catalogSnapshotHash`. Regeneration produces a new immutable version; a signed statement is permanently locked (existing Phase 25/26 behavior).

### 6. Delivery, signature, RBAC (D8/D9)
Delivery reuses the Family Portal document surface (`familyVisible` + existing download); signature reuses `signatureService` (signer roles `next_of_kin`/`authorized_representative`/`primary_contact`, email-correlated) with checksum re-verification. **No new RBAC keys**: statement uses `document.generate`/`document.view`; GPL + supplemental config use `serviceCatalog.edit`; cash advances use `caseOrder.update`. A PDF in the portal is **not** represented as universally satisfying every FTC delivery obligation (D8, `COMPLIANCE_BOUNDARY.md`).

## Wix Data (new; created at the live checkpoint)
`caseCashAdvanceItems` (83), `billingSupplementalConfigs` (84), `orgDocuments` (85); additive nullable `ServiceCatalogItem.ftcClass`. No change to `caseOrders`, the GL, or `rolePermissions`.

## Structural invariants (test-enforced)
Only `documentService` touches the renderer/storage; `cashAdvanceService` imports no accounting writer; the pure renderers do no I/O; mandatory federal disclosure text appears only in the system-locked registry, never inlined in a renderer/route/component; the FTC statement total reconciles to goods + cash advances; classification never fabricates meaning for an unknown category.

## Legal boundary
See `docs/COMPLIANCE_BOUNDARY.md`. Beacon assists with structured FTC documents; it does not guarantee compliance. The federal disclosure wording is system-controlled but must be verified against the current Rule by counsel; state/local/cemetery/crematory requirements and physical furnishing remain the provider's responsibility.
