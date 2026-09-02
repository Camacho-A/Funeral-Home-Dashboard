import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Phase 39 (Family Billing & FTC Compliance). Structural guarantees:
 *  1. render/store boundary — only documentService touches the PDF renderer /
 *     Blob storage; the billing layer routes through documentService.
 *  2. AR/GL isolation — the display-only cash-advance path never imports any
 *     accounting/pricing/payment writer.
 *  3. mandatory FTC disclosure text lives ONLY in the system-locked registry,
 *     never inlined in a renderer/route/component.
 */
describe('Phase 39 billing structural boundaries', () => {
  it('the billing layer never imports the PDF renderer or Blob storage directly', () => {
    const providerImport = /(puppeteerDocumentRenderer|vercelBlobStorageProvider)/;
    for (const f of [
      'services/billingDocumentService.ts',
      'services/cashAdvanceService.ts',
      'services/orgDocumentService.ts',
      'domain/billing/renderStatementHtml.ts',
      'domain/billing/renderGeneralPriceListHtml.ts',
    ]) {
      expect(read(f)).not.toMatch(providerImport);
    }
  });

  it('cashAdvanceService is isolated from accounting (never imports pricing/payment/ledger writers)', () => {
    const src = read('services/cashAdvanceService.ts');
    expect(src).not.toMatch(/pricingService|paymentService|generalLedgerService|postRevenueRecognition|refreshBalance/);
  });

  it('the pure renderers never touch I/O or accounting services', () => {
    for (const f of ['domain/billing/renderStatementHtml.ts', 'domain/billing/renderGeneralPriceListHtml.ts']) {
      const src = read(f);
      expect(src).not.toMatch(/from '\.\.\/\.\.\/services|wixDataApi|fetch\(/);
    }
  });

  it('mandatory FTC disclosure text lives only in the system-locked registry (not in renderers/routes/components)', () => {
    // A phrase that only appears in the mandated federal disclosures.
    const federalPhrase = 'You may choose only the items you desire';
    expect(read('domain/billing/ftcComplianceRegistry.ts')).toContain(federalPhrase);
    // It must NOT be hardcoded anywhere else.
    for (const f of [
      'domain/billing/renderStatementHtml.ts',
      'domain/billing/renderGeneralPriceListHtml.ts',
      'services/billingDocumentService.ts',
    ]) {
      expect(read(f)).not.toContain(federalPhrase);
    }
  });
});
