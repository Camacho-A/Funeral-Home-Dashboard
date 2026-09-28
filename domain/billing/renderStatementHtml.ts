import { formatCents, escapeHtml, formatStatementDate } from './renderUtil';
import { FTC_CLASS } from './ftcComplianceRegistry';
import type { BillingStatementModel, StatementLineItem } from './billingModels';

/**
 * Phase 39 (Family Billing & FTC Compliance). PURE renderer for the FTC
 * "Statement of Funeral Goods and Services Selected" (16 CFR 453.2(b)(5)).
 * Deterministic (same model → same HTML), no I/O. Every dynamic value is
 * HTML-escaped. Returns an HTML fragment; documentService wraps + renders +
 * stores it.
 *
 * CRITICAL COMPLIANCE INVARIANT (D4): the FTC "total cost of arrangements"
 * (goods/services + cash advances) and Solis's authoritative Accounts
 * Receivable balance due (from the CaseOrder, cash-advances excluded) are
 * rendered as DISTINCT, explicitly-labeled figures. Cash advances are marked
 * display-only and, where estimated, labeled as estimates.
 */
export class StatementRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatementRenderError';
  }
}

function moneyCell(cents: number): string {
  return `<td style="text-align:right; white-space:nowrap;">${formatCents(cents)}</td>`;
}

/** Item #2 (2026-09). A clean, professional business-identity header: an
    optional logo, then name/address/phone/fax/email — each contact line
    included only when the provider actually has a value for it (so an
    organization with no fax/email/logo configured renders exactly as
    before this change). The logo is constrained by `height` only
    (`width: auto`) so its real aspect ratio is always preserved, never
    stretched to a fixed box. */
function renderProviderHeader(provider: BillingStatementModel['provider']): string {
  const logoHtml = provider.logoDataUri
    ? `<img src="${escapeHtml(provider.logoDataUri)}" alt="${escapeHtml(provider.name)} logo" style="height:56px; width:auto; display:block; margin-bottom:6px;" />`
    : '';
  const addressHtml = provider.addressLine
    .split('\n')
    .map((line) => escapeHtml(line))
    .join('<br/>');
  const contactLines = [
    provider.phone ? `Phone: ${escapeHtml(provider.phone)}` : null,
    provider.fax ? `Fax: ${escapeHtml(provider.fax)}` : null,
    provider.email ? `Email: ${escapeHtml(provider.email)}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('<br/>');

  return `<header>
    ${logoHtml}
    <p style="margin:0; font-size:1.05em; font-weight:bold; letter-spacing:0.3px;">${escapeHtml(provider.name)}</p>
    <p style="margin:2px 0 0;">${addressHtml}</p>
    ${contactLines ? `<p style="margin:2px 0 0;">${contactLines}</p>` : ''}
  </header>`;
}

function lineRow(line: StatementLineItem): string {
  const feeNote = line.includesBasicServicesFee
    ? ` <span style="font-style:italic; font-size:0.85em;">(includes our basic services fee)</span>`
    : '';
  return `<tr>
    <td>${escapeHtml(line.description)}${feeNote}</td>
    <td style="text-align:center;">${line.quantity}</td>
    ${moneyCell(line.unitPriceCents)}
    ${moneyCell(line.lineTotalCents)}
  </tr>`;
}

export function renderStatementHtml(model: BillingStatementModel): string {
  const basicServicesLines = model.lineItems.filter((l) => l.ftcClass === FTC_CLASS.BASIC_SERVICES_FEE);
  const goodsLines = model.lineItems.filter((l) => l.ftcClass === FTC_CLASS.GOODS_AND_SERVICES);
  const unclassifiedLines = model.lineItems.filter((l) => l.ftcClass === FTC_CLASS.UNCLASSIFIED);

  // Structural completeness: the total-of-arrangements section must reconcile.
  if (model.ftcStatementTotalCents !== model.goodsAndServicesTotalCents + model.cashAdvanceSubtotalCents) {
    throw new StatementRenderError('FTC statement total must equal goods/services total plus cash-advance subtotal.');
  }

  // Item #2 (2026-09). An organization that suppresses the itemized Cash
  // Advance Items section (see organizationStatementOverrides.ts) is only
  // ever expected to have zero cash advance items. If one somehow exists
  // anyway, refuse to render rather than silently hiding a real dollar
  // amount that the visible line items would then fail to reconcile to —
  // this is the same "stop rather than mislead" posture as the total-
  // reconciliation check just above.
  if (!model.showCashAdvanceSection && model.cashAdvanceItems.length > 0) {
    throw new StatementRenderError(
      'This organization suppresses the Cash Advance Items section, but this case has cash advance items — cannot render a Statement whose total would not reconcile to its visible line items.',
    );
  }

  const basicFeeExplanation =
    model.basicServicesFeeMode === 'included_in_priced_service'
      ? `<p style="font-size:0.9em;">Our basic services fee is included in the price of the direct cremation shown above; it is not charged separately.</p>`
      : `<p style="font-size:0.9em;">Our basic services fee is a non-declinable charge listed above.</p>`;

  const goodsSection = `
    <h2 style="border-bottom:2px solid #333; padding-bottom:4px;">Funeral Goods and Services Selected</h2>
    <table style="width:100%; border-collapse:collapse;" cellpadding="6">
      <thead><tr style="border-bottom:1px solid #999;">
        <th style="text-align:left;">Item</th><th>Qty</th>
        <th style="text-align:right;">Unit Price</th><th style="text-align:right;">Amount</th>
      </tr></thead>
      <tbody>
        ${basicServicesLines.map(lineRow).join('')}
        ${goodsLines.map(lineRow).join('')}
        ${unclassifiedLines.length ? `<tr><td colspan="4" style="font-style:italic; color:#a00;">Additional items pending FTC classification:</td></tr>${unclassifiedLines.map(lineRow).join('')}` : ''}
      </tbody>
      <tfoot><tr style="border-top:2px solid #333; font-weight:bold;">
        <td colspan="3">Total funeral goods and services</td>${moneyCell(model.goodsAndServicesTotalCents)}
      </tr></tfoot>
    </table>
    ${basicFeeExplanation}`;

  // Item #2 (2026-09). Organizations that don't use cash advances at all
  // (see organizationStatementOverrides.ts) get no section here — not an
  // empty heading, not a "No cash advance items." placeholder, nothing.
  // The guard above already ensures showCashAdvanceSection === false implies
  // zero cash advance items, so there's no case where real data is hidden.
  let cashAdvanceSection = '';
  if (model.showCashAdvanceSection) {
    const cashAdvanceRows = model.cashAdvanceItems.length
      ? model.cashAdvanceItems
          .map((c) => {
            const flags = [c.isEstimated ? 'estimated' : null, c.hasMarkup ? 'includes a service charge' : null].filter(Boolean).join('; ');
            return `<tr>
              <td>${escapeHtml(c.description)}${flags ? ` <span style="font-style:italic; font-size:0.85em;">(${escapeHtml(flags)})</span>` : ''}</td>
              ${moneyCell(c.amountCents)}
            </tr>`;
          })
          .join('')
      : `<tr><td colspan="2" style="font-style:italic;">No cash advance items.</td></tr>`;

    cashAdvanceSection = `
      <h2 style="border-bottom:2px solid #333; padding-bottom:4px;">Cash Advance Items</h2>
      <p style="font-size:0.9em;">Cash advance items are goods or services we obtain from third parties on your behalf. These amounts are shown for your information and, where noted, are good-faith estimates.</p>
      <table style="width:100%; border-collapse:collapse;" cellpadding="6">
        <tbody>${cashAdvanceRows}</tbody>
        <tfoot><tr style="border-top:1px solid #999; font-weight:bold;">
          <td>Total cash advance items</td>${moneyCell(model.cashAdvanceSubtotalCents)}
        </tr></tfoot>
      </table>`;
  }

  // The two-figure block that keeps the FTC total and the AR balance distinct.
  const totalsSection = `
    <h2 style="border-bottom:2px solid #333; padding-bottom:4px;">Total Cost of Arrangements</h2>
    <table style="width:100%; border-collapse:collapse;" cellpadding="6">
      <tbody>
        <tr><td>Funeral goods and services</td>${moneyCell(model.goodsAndServicesTotalCents)}</tr>
        <tr><td>Cash advance items</td>${moneyCell(model.cashAdvanceSubtotalCents)}</tr>
        <tr style="border-top:2px solid #333; font-weight:bold;"><td>Total cost of arrangements (this statement)</td>${moneyCell(model.ftcStatementTotalCents)}</tr>
      </tbody>
    </table>
    <div style="margin-top:12px; padding:10px; border:1px solid #999; background:#f6f6f6; font-size:0.9em;">
      <strong>Account balance (amount owed to ${escapeHtml(model.provider.name)}):</strong>
      <table style="width:100%; border-collapse:collapse;" cellpadding="4">
        <tbody>
          <tr><td>Funeral goods and services charged</td>${moneyCell(model.goodsAndServicesTotalCents)}</tr>
          <tr><td>Payments received to date</td>${moneyCell(-model.paidToDateCents)}</tr>
          <tr style="font-weight:bold;"><td>Balance due to ${escapeHtml(model.provider.name)}</td>${moneyCell(model.authoritativeArBalanceDueCents)}</tr>
        </tbody>
      </table>
      <p style="margin:6px 0 0;">Note: the account balance shown above is what you owe ${escapeHtml(model.provider.name)} for funeral goods and services. Cash advance items are billed and settled separately and are <em>not</em> included in this account balance.</p>
    </div>`;

  const requiredPurchaseSection = `
    <h2 style="border-bottom:2px solid #333; padding-bottom:4px;">Required Purchases</h2>
    <p style="font-size:0.9em;">${
      model.requiredPurchaseExplanations && model.requiredPurchaseExplanations.trim().length > 0
        ? escapeHtml(model.requiredPurchaseExplanations)
        : 'No purchases in this statement are required by law, cemetery, or crematory beyond those you selected.'
    }</p>`;

  const disclosuresSection = `
    <h2 style="border-bottom:2px solid #333; padding-bottom:4px;">Required Disclosures</h2>
    ${model.disclosures.map((d) => `<p style="font-size:0.9em;">${escapeHtml(d.text)}</p>`).join('')}`;

  const supplementalForDoc = model.supplementalBlocks.filter((b) => b.document === 'statement_of_goods_and_services');
  const supplementalSection = supplementalForDoc.length
    ? `<h2 style="border-bottom:1px solid #999; padding-bottom:4px;">Additional Information from ${escapeHtml(model.provider.name)}</h2>
       <p style="font-size:0.8em; font-style:italic;">The following is supplemental information provided by the funeral home. It does not replace or modify the required disclosures above.</p>
       ${supplementalForDoc.map((b) => `<p style="font-size:0.9em;">${escapeHtml(b.text)}</p>`).join('')}`
    : '';

  const statementDateDisplay = formatStatementDate(model.generatedAt);

  return `
    ${renderProviderHeader(model.provider)}
    <h1 style="margin:10px 0 2px;">Statement of Funeral Goods and Services Selected</h1>
    <section style="margin-top:10px;">
      <table style="width:100%;" cellpadding="2"><tbody>
        <tr><td><strong>Decedent:</strong> ${escapeHtml(model.decedentName)}</td><td style="text-align:right;"><strong>Case:</strong> ${escapeHtml(model.caseNumber)}</td></tr>
        <tr><td><strong>Date of death:</strong> ${model.dateOfDeath ? escapeHtml(model.dateOfDeath) : '—'}</td><td style="text-align:right;"><strong>Statement date:</strong> ${escapeHtml(statementDateDisplay)}</td></tr>
      </tbody></table>
    </section>
    ${goodsSection}
    ${cashAdvanceSection}
    ${totalsSection}
    ${requiredPurchaseSection}
    ${disclosuresSection}
    ${supplementalSection}
    <footer style="margin-top:16px; font-size:0.75em; color:#666; border-top:1px solid #ccc; padding-top:6px;">
      Order version ${model.orderVersion} · Disclosure version ${escapeHtml(model.disclosureVersion)} · Generated ${escapeHtml(statementDateDisplay)}
    </footer>`;
}
