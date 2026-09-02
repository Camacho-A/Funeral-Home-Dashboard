import { formatCents, escapeHtml } from './renderUtil';
import { FTC_CLASS } from './ftcComplianceRegistry';
import type { GeneralPriceListModel, GplServiceLine } from './billingModels';

/**
 * Phase 39 (Family Billing & FTC Compliance). PURE renderer for the FTC
 * General Price List (16 CFR 453.2(b)(4)). Deterministic, no I/O, fully
 * HTML-escaped. Reflects ONLY the provider's actual configured offerings —
 * it never invents products or categories to populate the list (D7). For a
 * direct-cremation provider, the direct-cremation line describes what the
 * quoted price includes and the alternative-container disclosure applies.
 */
function serviceRow(line: GplServiceLine): string {
  const feeNote = line.includesBasicServicesFee
    ? ` <span style="font-style:italic; font-size:0.85em;">(includes our basic services fee)</span>`
    : '';
  return `<tr><td>${escapeHtml(line.displayName)}${feeNote}</td><td style="text-align:right; white-space:nowrap;">${formatCents(line.priceCents)}</td></tr>`;
}

export function renderGeneralPriceListHtml(model: GeneralPriceListModel): string {
  const servicesByBasic = model.serviceLines.filter((l) => l.ftcClass === FTC_CLASS.BASIC_SERVICES_FEE);
  const otherServices = model.serviceLines.filter((l) => l.ftcClass !== FTC_CLASS.BASIC_SERVICES_FEE);

  const servicesSection = model.serviceLines.length
    ? `<h2 style="border-bottom:2px solid #333; padding-bottom:4px;">Services</h2>
       <table style="width:100%; border-collapse:collapse;" cellpadding="6"><tbody>
         ${servicesByBasic.map(serviceRow).join('')}
         ${otherServices.map(serviceRow).join('')}
       </tbody></table>`
    : '';

  const merchandiseSection = model.merchandiseLines.length
    ? `<h2 style="border-bottom:2px solid #333; padding-bottom:4px;">Merchandise</h2>
       <table style="width:100%; border-collapse:collapse;" cellpadding="6"><tbody>
         ${model.merchandiseLines
           .map((m) => `<tr><td>${escapeHtml(m.name)}</td><td style="text-align:right; white-space:nowrap;">${formatCents(m.priceCents)}</td></tr>`)
           .join('')}
       </tbody></table>`
    : '';

  const disclosuresSection = `
    <h2 style="border-bottom:2px solid #333; padding-bottom:4px;">Required Disclosures</h2>
    ${model.disclosures.map((d) => `<p style="font-size:0.9em;">${escapeHtml(d.text)}</p>`).join('')}`;

  const supplementalForDoc = model.supplementalBlocks.filter((b) => b.document === 'general_price_list');
  const supplementalSection = supplementalForDoc.length
    ? `<h2 style="border-bottom:1px solid #999; padding-bottom:4px;">Additional Information from ${escapeHtml(model.provider.name)}</h2>
       <p style="font-size:0.8em; font-style:italic;">The following is supplemental information provided by the funeral home. It does not replace or modify the required disclosures above.</p>
       ${supplementalForDoc.map((b) => `<p style="font-size:0.9em;">${escapeHtml(b.text)}</p>`).join('')}`
    : '';

  return `
    <header>
      <h1 style="margin-bottom:2px;">General Price List</h1>
      <p style="margin:0;"><strong>${escapeHtml(model.provider.name)}</strong><br/>${escapeHtml(model.provider.addressLine)}<br/>${escapeHtml(model.provider.phone)}</p>
      <p style="margin:6px 0 0; font-size:0.9em;">These prices are effective as of ${escapeHtml(model.effectiveDate)} and are subject to change without notice.</p>
    </header>
    ${servicesSection}
    ${merchandiseSection}
    ${disclosuresSection}
    ${supplementalSection}
    <footer style="margin-top:16px; font-size:0.75em; color:#666; border-top:1px solid #ccc; padding-top:6px;">
      Effective ${escapeHtml(model.effectiveDate)} · Disclosure version ${escapeHtml(model.disclosureVersion)} · Generated ${escapeHtml(model.generatedAt)}
    </footer>`;
}
