import type { DataAdapterMode } from '../lib/env';
import { listProductsForOrganization, updateProduct } from './merchandiseService';
import { listSuppliersForOrganization, createSupplier } from './supplierService';
import type { ActivityContext } from './activityService';

/**
 * Phase 36 (Procurement & Accounts Payable). One-time backfill of
 * `MerchandiseProduct.supplierId` from the Phase 35 free-text
 * `supplierName`. DETERMINISTIC matching only (exact, case-insensitive,
 * organization-scoped) — never fuzzy, never guessed. `supplierName` is
 * PRESERVED as historical snapshot; it is never cleared. Dry-run first;
 * apply is idempotent. See docs/adr/ADR-040-procurement-and-accounts-payable.md.
 *
 * Classifications a product falls into:
 *   - alreadyLinked      supplierId already set → skipped.
 *   - noSupplierName     no free-text name → nothing to do.
 *   - wouldLink          exactly ONE existing supplier matches the name.
 *   - wouldCreateAndLink a name with no supplier yet (apply creates one,
 *                        deterministically deduped by name, then links) —
 *                        only when `createMissingSuppliers` is enabled.
 *   - unmatched          name has no supplier and creation is disabled.
 *   - ambiguous          MORE THAN ONE supplier matches the name → REPORTED,
 *                        never linked (no guessing which is correct).
 */
const norm = (s: string) => s.trim().toLowerCase();

export type SupplierBackfillPlanRow = { productId: string; sku: string; supplierName: string; classification: 'wouldLink' | 'wouldCreateAndLink' | 'unmatched' | 'ambiguous'; matchedSupplierId: string | null };
export type SupplierBackfillPlan = {
  alreadyLinked: number;
  noSupplierName: number;
  wouldLink: SupplierBackfillPlanRow[];
  wouldCreateAndLink: SupplierBackfillPlanRow[];
  unmatched: SupplierBackfillPlanRow[];
  ambiguous: SupplierBackfillPlanRow[];
  distinctSupplierNames: string[];
  duplicateSupplierNames: string[];
};

export async function planSupplierBackfill(organizationId: string, dataAdapterMode: DataAdapterMode, options: { createMissingSuppliers?: boolean } = {}): Promise<SupplierBackfillPlan> {
  const [products, suppliers] = await Promise.all([
    listProductsForOrganization(organizationId, dataAdapterMode, { includeInactive: true }),
    listSuppliersForOrganization(organizationId, dataAdapterMode, { includeInactive: true }),
  ]);
  // Group suppliers by normalized name to detect duplicates (ambiguity).
  const suppliersByName = new Map<string, string[]>();
  for (const s of suppliers) {
    const key = norm(s.name);
    suppliersByName.set(key, [...(suppliersByName.get(key) ?? []), s.id]);
  }
  const duplicateSupplierNames = [...suppliersByName.entries()].filter(([, ids]) => ids.length > 1).map(([name]) => name);

  const plan: SupplierBackfillPlan = { alreadyLinked: 0, noSupplierName: 0, wouldLink: [], wouldCreateAndLink: [], unmatched: [], ambiguous: [], distinctSupplierNames: [], duplicateSupplierNames };
  const distinct = new Set<string>();
  for (const p of products) {
    if (p.supplierId) { plan.alreadyLinked++; continue; }
    if (!p.supplierName || p.supplierName.trim().length === 0) { plan.noSupplierName++; continue; }
    const key = norm(p.supplierName);
    distinct.add(key);
    const matches = suppliersByName.get(key) ?? [];
    const row = { productId: p.id, sku: p.sku, supplierName: p.supplierName };
    if (matches.length === 1) plan.wouldLink.push({ ...row, classification: 'wouldLink', matchedSupplierId: matches[0] });
    else if (matches.length > 1) plan.ambiguous.push({ ...row, classification: 'ambiguous', matchedSupplierId: null });
    else if (options.createMissingSuppliers) plan.wouldCreateAndLink.push({ ...row, classification: 'wouldCreateAndLink', matchedSupplierId: null });
    else plan.unmatched.push({ ...row, classification: 'unmatched', matchedSupplierId: null });
  }
  plan.distinctSupplierNames = [...distinct].sort();
  return plan;
}

export type SupplierBackfillResult = { linked: number; suppliersCreated: number; skippedAmbiguous: number; skippedUnmatched: number };

/**
 * Idempotent apply. Links every unambiguous product; when
 * `createMissingSuppliers` is on, first creates one supplier per distinct
 * unmatched name (deduped by name, so re-runs never duplicate) then links.
 * Ambiguous names are NEVER linked — they are counted and left for a human.
 */
export async function applySupplierBackfill(organizationId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode, options: { createMissingSuppliers?: boolean; idFactory: () => string; now?: string }): Promise<SupplierBackfillResult> {
  const plan = await planSupplierBackfill(organizationId, dataAdapterMode, { createMissingSuppliers: options.createMissingSuppliers });
  const result: SupplierBackfillResult = { linked: 0, suppliersCreated: 0, skippedAmbiguous: plan.ambiguous.length, skippedUnmatched: plan.unmatched.length };

  // Create missing suppliers (one per distinct name), deterministically.
  const createdByName = new Map<string, string>();
  if (options.createMissingSuppliers) {
    const namesToCreate = [...new Set(plan.wouldCreateAndLink.map((r) => norm(r.supplierName)))];
    for (const key of namesToCreate) {
      const display = plan.wouldCreateAndLink.find((r) => norm(r.supplierName) === key)!.supplierName.trim();
      try {
        const supplier = await createSupplier({ organizationId, name: display, idFactory: options.idFactory, now: options.now }, ctx, dataAdapterMode);
        createdByName.set(key, supplier.id);
        result.suppliersCreated++;
      } catch {
        // duplicate_name (a concurrent/previous run already created it) — re-resolve.
        const existing = (await listSuppliersForOrganization(organizationId, dataAdapterMode, { includeInactive: true })).find((s) => norm(s.name) === key);
        if (existing) createdByName.set(key, existing.id);
      }
    }
  }

  const toLink = [...plan.wouldLink, ...(options.createMissingSuppliers ? plan.wouldCreateAndLink : [])];
  for (const row of toLink) {
    const supplierId = row.matchedSupplierId ?? createdByName.get(norm(row.supplierName));
    if (!supplierId) continue; // unresolved (should not happen) — skip rather than guess
    await updateProduct(organizationId, row.productId, { supplierId, now: options.now }, ctx, dataAdapterMode);
    result.linked++;
  }
  return result;
}
