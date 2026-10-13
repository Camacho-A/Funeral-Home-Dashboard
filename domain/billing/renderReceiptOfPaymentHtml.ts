import {
  RECEIPT_STATUS_LABEL,
  formatReceiptMoney,
  type ReceiptOfPaymentModel,
} from './receiptOfPayment';

/**
 * Receipt of Payment — HTML, rendered to PDF by the existing pipeline
 * (services/documentService.ts#renderAndStorePdf). No second renderer and
 * no second storage path.
 *
 * Reproduces Manors' own "MANORS RECEIPT OF PAYMENT" document: the logo
 * and "Receipt of Payment" heading, the date / contract / sold-to /
 * status block, the three-column payment-method strip, the itemised
 * charges table with its TOTAL CHARGE / DISCOUNT / PAYMENT / BALANCE DUE
 * summary, and the footer naming the legal entity.
 *
 * Inline styles throughout, because the PDF renderer receives one
 * self-contained document with no stylesheet to resolve — the same
 * constraint renderStatementHtml.ts already works under.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** An absent IDENTITY value reads as an em dash — never blank, so a
    missing field is visibly missing rather than looking like it was left
    off. Written as an entity so it survives any renderer that mishandles
    the literal character. */
function orDash(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? '&mdash;' : escapeHtml(trimmed);
}

/** An absent OPTIONAL-COLUMN value reads as blank, matching the original
    document — the Item # column is empty there for a service with no
    catalogue code, not dashed. */
function orBlank(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? '' : escapeHtml(trimmed);
}

const CELL = 'padding:6px 8px; border:1px solid #333; font-size:11pt; vertical-align:top;';
const HEAD_CELL = `${CELL} background:#efefef; font-weight:700; text-align:center;`;
const NUM_CELL = `${CELL} text-align:right; white-space:nowrap;`;
const SUMMARY_LABEL = `${CELL} text-align:right; font-weight:700; background:#efefef;`;

export function renderReceiptOfPaymentHtml(model: ReceiptOfPaymentModel): string {
  const logo = model.provider.logoDataUri
    ? `<img src="${model.provider.logoDataUri}" alt="" style="max-height:78px; max-width:260px;" />`
    : '';

  const itemRows =
    model.lineItems.length > 0
      ? model.lineItems
          .map(
            (line) => `
            <tr>
              <td style="${CELL} text-align:center;">${line.quantity}</td>
              <td style="${CELL} text-align:center;">${orBlank(line.itemNumber)}</td>
              <td style="${CELL}">${escapeHtml(line.description)}</td>
              <td style="${NUM_CELL}">${formatReceiptMoney(line.costCents)}</td>
              <td style="${NUM_CELL}">${line.discountCents > 0 ? formatReceiptMoney(line.discountCents) : ''}</td>
              <td style="${NUM_CELL}">${formatReceiptMoney(line.totalCents)}</td>
            </tr>`,
          )
          .join('')
      : `<tr><td style="${CELL}" colspan="6">No itemised charges are recorded for this case.</td></tr>`;

  /** One row per recorded payment, so multiple payments and multiple
      methods each appear rather than being collapsed into a total. */
  const paymentRows =
    model.payments.length > 0
      ? model.payments
          .map(
            (p, index) => `
            <tr>
              <td style="${CELL}">${escapeHtml(p.methodLabel)}${p.paidAtDisplay ? ` &nbsp; ${escapeHtml(p.paidAtDisplay)}` : ''}</td>
              <td style="${CELL}">${index === 0 ? orDash(model.dateOfDeathDisplay) : ''}</td>
              <td style="${CELL}">${index === 0 ? escapeHtml(model.deceasedName) : ''}</td>
            </tr>`,
          )
          .join('')
      : `<tr>
           <td style="${CELL}">—</td>
           <td style="${CELL}">${orDash(model.dateOfDeathDisplay)}</td>
           <td style="${CELL}">${escapeHtml(model.deceasedName)}</td>
         </tr>`;

  const statusLine =
    model.status === 'paid_in_full'
      ? `${RECEIPT_STATUS_LABEL.paid_in_full}:${model.paidInFullDateDisplay ? `&nbsp; ${escapeHtml(model.paidInFullDateDisplay)}` : ''}`
      : `${RECEIPT_STATUS_LABEL[model.status]}:&nbsp; ${formatReceiptMoney(model.balanceDueCents)}`;

  return `
  <div style="font-family: Arial, Helvetica, sans-serif; color:#111;">

    <table style="width:100%; border-collapse:collapse; margin-bottom:10px;">
      <tr>
        <td style="width:45%; vertical-align:middle;">${logo}</td>
        <td style="text-align:right; vertical-align:middle;">
          <div style="font-size:22pt; font-weight:700; letter-spacing:0.01em;">Receipt of Payment</div>
          <div style="font-size:13pt; font-weight:700; margin-top:2px;">${escapeHtml(model.provider.name)}</div>
        </td>
      </tr>
    </table>

    <table style="width:100%; border-collapse:collapse; margin-bottom:14px; font-size:11pt;">
      <tr>
        <td style="width:60%; padding:2px 0;"></td>
        <td style="padding:2px 0; text-align:right;">Date: ${escapeHtml(model.statementDateDisplay)}</td>
      </tr>
      <tr>
        <td style="padding:2px 0; font-weight:700;">Contract # ${escapeHtml(model.caseNumber)}</td>
        <td style="padding:2px 0;"></td>
      </tr>
      <tr>
        <td style="padding:6px 0 2px; font-weight:700;">SOLD TO:</td>
        <td style="padding:6px 0 2px; text-align:right;">${orDash(model.soldToName)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0 2px; font-weight:700;" colspan="2">${statusLine}</td>
      </tr>
    </table>

    <table style="width:100%; border-collapse:collapse; margin-bottom:14px;">
      <thead>
        <tr>
          <th style="${HEAD_CELL} width:40%;">Payment Method / Date Paid</th>
          <th style="${HEAD_CELL} width:25%;">Date of Death</th>
          <th style="${HEAD_CELL}">Deceased</th>
        </tr>
      </thead>
      <tbody>${paymentRows}</tbody>
    </table>

    <table style="width:100%; border-collapse:collapse;">
      <thead>
        <tr>
          <th style="${HEAD_CELL} width:7%;">Qty</th>
          <th style="${HEAD_CELL} width:12%;">Item #</th>
          <th style="${HEAD_CELL}">Description</th>
          <th style="${HEAD_CELL} width:14%;">Cost</th>
          <th style="${HEAD_CELL} width:14%;">Discount</th>
          <th style="${HEAD_CELL} width:14%;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr>
          <td style="${CELL}" colspan="4"></td>
          <td style="${SUMMARY_LABEL}">TOTAL CHARGE</td>
          <td style="${NUM_CELL}">${formatReceiptMoney(model.totalChargeCents)}</td>
        </tr>
        <tr>
          <td style="${CELL}" colspan="4"></td>
          <td style="${SUMMARY_LABEL}">DISCOUNT</td>
          <td style="${NUM_CELL}">${model.discountCents > 0 ? formatReceiptMoney(model.discountCents) : ''}</td>
        </tr>
        <tr>
          <td style="${CELL}" colspan="4"></td>
          <td style="${SUMMARY_LABEL}">PAYMENT</td>
          <td style="${NUM_CELL}">${formatReceiptMoney(model.paymentCents)}</td>
        </tr>
        <tr>
          <td style="${CELL}" colspan="4"></td>
          <td style="${SUMMARY_LABEL}">BALANCE DUE</td>
          <td style="${NUM_CELL} font-weight:700;">${formatReceiptMoney(model.balanceDueCents)}</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top:26px; text-align:center; font-size:10.5pt; line-height:1.5;">
      <div>${escapeHtml(model.footer.thanksLine)}</div>
      ${model.footer.legalEntityLine ? `<div style="font-weight:700;">${escapeHtml(model.footer.legalEntityLine)}</div>` : ''}
      <div>Phone: ${escapeHtml(model.provider.phone ?? '')} | ${escapeHtml((model.provider.addressLine ?? '').replace(/\n/g, ' '))}</div>
    </div>
  </div>`;
}
