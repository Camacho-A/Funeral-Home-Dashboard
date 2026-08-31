import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { merchandiseProductFixtures } from './__mocks__/merchandiseFixtures';
import { supplierFixtures } from './__mocks__/procurementFixtures';
import type { MerchandiseProduct } from '../types/merchandiseProduct';
import { createSupplier } from './supplierService';
import { planSupplierBackfill, applySupplierBackfill } from './supplierMigrationService';

let idCounter = 0;
const idFactory = () => `id-${(idCounter += 1)}`;
const NOW = '2026-08-21T00:00:00.000Z';
const ORG = DEFAULT_ORGANIZATION_ID;
const CTX = { organizationId: ORG, actorIdentityId: 'i', actorMembershipId: null, actorRoleKey: null, correlationId: 'c' };

function product(over: Partial<MerchandiseProduct>): MerchandiseProduct {
  return { id: idFactory(), organizationId: ORG, sku: `SK-${idCounter}`, name: 'P', description: null, category: 'urn', cost: 1, retailPrice: 2, taxable: false, isActive: true, trackInventory: true, reorderPoint: null, defaultLocationId: null, imageStorageKey: null, familyVisible: false, supplierName: null, supplierId: null, parentProductId: null, hasVariants: false, createdAt: NOW, updatedAt: NOW, ...over };
}

beforeEach(() => {
  idCounter = 0;
  for (const a of [activityEventFixtures, merchandiseProductFixtures, supplierFixtures]) a.length = 0;
});

describe('supplierMigrationService — deterministic, ambiguity-reporting', () => {
  it('classifies alreadyLinked / noSupplierName / wouldLink / ambiguous', async () => {
    const acme = await createSupplier({ organizationId: ORG, name: 'Acme', idFactory, now: NOW }, CTX, 'mock');
    // Two suppliers sharing a name → ambiguous (defensive; app normally prevents it).
    supplierFixtures.push({ id: 'dupe-1', organizationId: ORG, name: 'Bronze', contactName: null, email: null, phone: null, addressText: null, paymentTermsDays: null, defaultExpenseAccountNumber: null, notes: null, isActive: true, createdAt: NOW, updatedAt: NOW });
    supplierFixtures.push({ id: 'dupe-2', organizationId: ORG, name: 'bronze', contactName: null, email: null, phone: null, addressText: null, paymentTermsDays: null, defaultExpenseAccountNumber: null, notes: null, isActive: true, createdAt: NOW, updatedAt: NOW });
    merchandiseProductFixtures.push(product({ supplierName: 'Acme' })); // wouldLink
    merchandiseProductFixtures.push(product({ supplierName: 'acme' })); // wouldLink (case-insensitive)
    merchandiseProductFixtures.push(product({ supplierName: 'Bronze' })); // ambiguous
    merchandiseProductFixtures.push(product({ supplierName: null })); // noSupplierName
    merchandiseProductFixtures.push(product({ supplierName: 'Ghost', supplierId: acme.id })); // alreadyLinked

    const plan = await planSupplierBackfill(ORG, 'mock');
    expect(plan.alreadyLinked).toBe(1);
    expect(plan.noSupplierName).toBe(1);
    expect(plan.wouldLink.map((r) => r.matchedSupplierId)).toEqual([acme.id, acme.id]);
    expect(plan.ambiguous).toHaveLength(1);
    expect(plan.unmatched).toHaveLength(0); // Bronze is ambiguous, not unmatched
    expect(plan.duplicateSupplierNames).toContain('bronze');
  });

  it('unmatched when no supplier exists and creation is disabled; never guesses', async () => {
    merchandiseProductFixtures.push(product({ supplierName: 'Nobody Inc' }));
    const plan = await planSupplierBackfill(ORG, 'mock', { createMissingSuppliers: false });
    expect(plan.unmatched).toHaveLength(1);
    expect(plan.wouldCreateAndLink).toHaveLength(0);
    const result = await applySupplierBackfill(ORG, CTX, 'mock', { createMissingSuppliers: false, idFactory, now: NOW });
    expect(result.linked).toBe(0);
    expect(result.skippedUnmatched).toBe(1);
    expect(merchandiseProductFixtures[0].supplierId).toBeNull(); // NOT linked
    expect(merchandiseProductFixtures[0].supplierName).toBe('Nobody Inc'); // preserved
  });

  it('createMissingSuppliers: creates one supplier per distinct name, links, and is idempotent', async () => {
    merchandiseProductFixtures.push(product({ supplierName: 'Vault Co' }));
    merchandiseProductFixtures.push(product({ supplierName: 'vault co' })); // same normalized name
    merchandiseProductFixtures.push(product({ supplierName: 'Urn LLC' }));

    const first = await applySupplierBackfill(ORG, CTX, 'mock', { createMissingSuppliers: true, idFactory, now: NOW });
    expect(first.suppliersCreated).toBe(2); // "vault co" deduped to one
    expect(first.linked).toBe(3);
    expect(merchandiseProductFixtures.every((p) => p.supplierId !== null)).toBe(true);
    expect(merchandiseProductFixtures.every((p) => p.supplierName !== null)).toBe(true); // preserved

    // Idempotent re-run: nothing new.
    const second = await applySupplierBackfill(ORG, CTX, 'mock', { createMissingSuppliers: true, idFactory, now: NOW });
    expect(second.suppliersCreated).toBe(0);
    expect(second.linked).toBe(0);
    expect(supplierFixtures.length).toBe(2);
  });
});
