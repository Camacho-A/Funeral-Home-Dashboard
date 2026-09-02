# Compliance Boundary — Beacon Family Billing & FTC Documents (Phase 39)

**Beacon assists funeral providers in producing structured FTC Funeral Rule documents. Beacon does NOT provide a legal-compliance guarantee.**

## What Beacon does

- Generates a **General Price List (GPL)** and a **Statement of Funeral Goods and Services Selected** from the provider's own configured catalog, prices, selections, and cash-advance entries.
- Renders the **mandatory federal disclosure text** from a single, **system-controlled, versioned registry** (`domain/billing/ftcComplianceRegistry.ts`). This wording is not editable through ordinary organization settings; organizations may add clearly-separated **optional supplemental** language only.
- Produces immutable PDF documents (checksummed, versioned), supports staff preview, download, print, Family Portal availability, and an audit trail; e-signature reuses the existing signature workflow.

## What Beacon does NOT do / what remains the provider's responsibility

- **Legal review of wording.** The disclosure strings in the system registry are Beacon's rendering of the Rule's required model language, each tagged with a `citation` and governed by `FTC_DISCLOSURE_VERSION`. **They must be verified verbatim against the current text of 16 CFR Part 453 by qualified counsel before production use.** Beacon can update the versioned wording deliberately if the Rule changes.
- **State and local law.** State statutes, boards, and local rules may impose additional requirements beyond the federal Rule. These are out of scope of the federal registry.
- **Cemetery / crematory requirements.** These are arrangement-specific and entered by the provider (required-purchase explanations); Beacon does not determine them.
- **Applicability of lists/categories.** Which of the FTC-listed categories apply (e.g. casket price list, outer-burial-container price list, embalming disclosures) depends on the provider's actual offerings. Beacon renders a conditional disclosure only when the provider's configuration indicates it offers that category — it never invents offerings, and it never implies the provider sells goods/services it has not configured.
- **Furnishing/physical offering.** Operational responsibility for furnishing or physically offering required documents where the Rule requires it remains with the funeral provider. A PDF being available in Beacon (including the Family Portal) is **not** represented as universally satisfying every FTC delivery obligation.

## Financial-scope boundary (cash advances)

The FTC "total cost of arrangements" on the Statement includes cash-advance items. In Phase 39 those items are **display-only** and are **not** posted to Beacon's ledger, Accounts Receivable, `CaseOrder` balance, `PaymentService`, or financial reporting. The Statement labels the FTC total and the authoritative account balance (amount owed to the provider) as **distinct** figures, and states that cash advances are billed/settled separately. GL-posted cash advances are a deferred, separately-designed feature.

## Where the mandatory content lives

- Mandatory federal disclosure text + structure + FTC classification keys: **`domain/billing/ftcComplianceRegistry.ts`** (system-locked, versioned).
- Optional org supplemental language: `billingSupplementalConfigs` (org-editable, clearly separated, never replaces mandatory text).
- If implementation encounters a genuine legal/compliance ambiguity, the correct action is to STOP and report it — never to invent a rule.
