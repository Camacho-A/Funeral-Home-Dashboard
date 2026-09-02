import type { CaseCashAdvanceItem } from '../../types/caseCashAdvanceItem';
import type { BillingSupplementalConfig } from '../../types/billingSupplementalConfig';
import type { OrgDocument } from '../../types/orgDocument';

/**
 * Phase 39 (Family Billing & FTC Compliance). Mock-mode stores for the new
 * billing collections — empty by default (a fresh org has no cash advances,
 * no custom supplemental language, and no generated GPLs yet).
 */
export const caseCashAdvanceItemFixtures: CaseCashAdvanceItem[] = [];
export const billingSupplementalConfigFixtures: BillingSupplementalConfig[] = [];
export const orgDocumentFixtures: OrgDocument[] = [];
