import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixSupplierItem,
  buildWixSupplierData,
  applySupplierUpdateToWixData,
  type WixSupplierItem,
} from '../lib/wixSupplierMapper';
import type { Supplier } from '../types/supplier';
import {
  recordSupplierCreated,
  recordSupplierUpdated,
  recordSupplierArchived,
  type ActivityContext,
  type FieldChange,
} from './activityService';
import { supplierFixtures } from './__mocks__/procurementFixtures';

/**
 * Phase 36 (Procurement & Accounts Payable). Sole writer of the `suppliers`
 * collection — the org's structured vendor directory. Suppliers archive
 * (`isActive: false`), never delete, so historical POs/bills always resolve.
 * Authorization is enforced at the route layer, never here. See
 * docs/adr/ADR-040-procurement-and-accounts-payable.md.
 */
export class SupplierServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'duplicate_name' | 'invalid_input',
  ) {
    super(message);
    this.name = 'SupplierServiceError';
  }
}

// --- Reads ------------------------------------------------------------------

export async function listSuppliersForOrganization(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  options: { includeInactive?: boolean } = {},
): Promise<Supplier[]> {
  let suppliers: Supplier[];
  if (dataAdapterMode === 'mock') {
    suppliers = supplierFixtures.filter((s) => s.organizationId === organizationId);
  } else {
    const response = await queryWixDataItems<WixSupplierItem>('suppliers', { filter: { organizationId } });
    suppliers = response.dataItems.map((i) => mapWixSupplierItem(i.data)).filter((s): s is Supplier => s !== null);
  }
  const filtered = options.includeInactive ? suppliers : suppliers.filter((s) => s.isActive);
  return filtered.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export async function getSupplierById(organizationId: string, supplierId: string, dataAdapterMode: DataAdapterMode): Promise<Supplier | null> {
  if (dataAdapterMode === 'mock') {
    return supplierFixtures.find((s) => s.organizationId === organizationId && s.id === supplierId) ?? null;
  }
  const response = await queryWixDataItems<WixSupplierItem>('suppliers', {
    filter: { organizationId, beaconSupplierId: supplierId },
    paging: { limit: 1 },
  });
  return mapWixSupplierItem(response.dataItems[0]?.data);
}

/** Case-insensitive per-org name lookup — the uniqueness check. Exported so
    the migration can deterministically match existing free-text names. */
export async function findSupplierByName(organizationId: string, name: string, dataAdapterMode: DataAdapterMode): Promise<Supplier | null> {
  const normalized = name.trim().toLowerCase();
  const all = await listSuppliersForOrganization(organizationId, dataAdapterMode, { includeInactive: true });
  return all.find((s) => s.name.trim().toLowerCase() === normalized) ?? null;
}

// --- Writes -----------------------------------------------------------------

export type CreateSupplierInput = {
  organizationId: string;
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  addressText?: string | null;
  paymentTermsDays?: number | null;
  defaultExpenseAccountNumber?: string | null;
  notes?: string | null;
  idFactory: () => string;
  now?: string;
};

export async function createSupplier(input: CreateSupplierInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<Supplier> {
  const name = input.name.trim();
  if (name.length === 0) throw new SupplierServiceError('Supplier name is required.', 'invalid_input');
  if (input.paymentTermsDays != null && (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0)) {
    throw new SupplierServiceError('paymentTermsDays must be a non-negative integer or null.', 'invalid_input');
  }
  const existing = await findSupplierByName(input.organizationId, name, dataAdapterMode);
  if (existing) throw new SupplierServiceError(`A supplier named "${name}" already exists.`, 'duplicate_name');

  const nowIso = input.now ?? new Date().toISOString();
  const supplier: Supplier = {
    id: input.idFactory(),
    organizationId: input.organizationId,
    name,
    contactName: input.contactName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    addressText: input.addressText ?? null,
    paymentTermsDays: input.paymentTermsDays ?? null,
    defaultExpenseAccountNumber: input.defaultExpenseAccountNumber ?? null,
    notes: input.notes ?? null,
    isActive: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (dataAdapterMode === 'mock') {
    supplierFixtures.push(supplier);
  } else {
    await insertWixDataItem('suppliers', buildWixSupplierData(supplier), supplier.id);
  }
  await bestEffort(() => recordSupplierCreated(ctx, supplier.id, supplier.name, dataAdapterMode));
  return supplier;
}

export type UpdateSupplierInput = Partial<
  Pick<Supplier, 'name' | 'contactName' | 'email' | 'phone' | 'addressText' | 'paymentTermsDays' | 'defaultExpenseAccountNumber' | 'notes'>
> & { now?: string };

export async function updateSupplier(organizationId: string, supplierId: string, patch: UpdateSupplierInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<Supplier> {
  const existing = await getSupplierById(organizationId, supplierId, dataAdapterMode);
  if (!existing) throw new SupplierServiceError('Supplier not found.', 'not_found');

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length === 0) throw new SupplierServiceError('Supplier name is required.', 'invalid_input');
    const clash = await findSupplierByName(organizationId, name, dataAdapterMode);
    if (clash && clash.id !== supplierId) throw new SupplierServiceError(`A supplier named "${name}" already exists.`, 'duplicate_name');
  }

  const nowIso = patch.now ?? new Date().toISOString();
  const changed: Record<string, FieldChange> = {};
  const next: Supplier = { ...existing, updatedAt: nowIso };
  const fields: (keyof UpdateSupplierInput)[] = ['name', 'contactName', 'email', 'phone', 'addressText', 'paymentTermsDays', 'defaultExpenseAccountNumber', 'notes'];
  for (const f of fields) {
    if (patch[f] === undefined) continue;
    const nextVal = f === 'name' ? (patch.name as string).trim() : patch[f];
    if ((existing as Record<string, unknown>)[f] !== nextVal) {
      changed[f] = { previous: (existing as Record<string, unknown>)[f], next: nextVal };
      (next as Record<string, unknown>)[f] = nextVal;
    }
  }
  if (Object.keys(changed).length === 0) return existing;

  await persistSupplierUpdate(next, { ...patch, name: next.name, updatedAt: nowIso }, dataAdapterMode);
  await bestEffort(() => recordSupplierUpdated(ctx, supplierId, changed, dataAdapterMode));
  return next;
}

export async function setSupplierArchived(organizationId: string, supplierId: string, archived: boolean, ctx: ActivityContext, dataAdapterMode: DataAdapterMode, now?: string): Promise<Supplier> {
  const existing = await getSupplierById(organizationId, supplierId, dataAdapterMode);
  if (!existing) throw new SupplierServiceError('Supplier not found.', 'not_found');
  if (existing.isActive === !archived) return existing;
  const nowIso = now ?? new Date().toISOString();
  const next: Supplier = { ...existing, isActive: !archived, updatedAt: nowIso };
  await persistSupplierUpdate(next, { isActive: next.isActive, updatedAt: nowIso }, dataAdapterMode);
  if (archived) await bestEffort(() => recordSupplierArchived(ctx, supplierId, dataAdapterMode));
  return next;
}

// --- internals --------------------------------------------------------------

async function persistSupplierUpdate(
  next: Supplier,
  patch: Partial<Pick<Supplier, 'name' | 'contactName' | 'email' | 'phone' | 'addressText' | 'paymentTermsDays' | 'defaultExpenseAccountNumber' | 'notes' | 'isActive' | 'updatedAt'>>,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const idx = supplierFixtures.findIndex((s) => s.id === next.id);
    if (idx >= 0) supplierFixtures[idx] = next;
    return;
  }
  const response = await queryWixDataItems<WixSupplierItem>('suppliers', {
    filter: { organizationId: next.organizationId, beaconSupplierId: next.id },
    paging: { limit: 1 },
  });
  const existingRaw = response.dataItems[0]?.data;
  if (!existingRaw) throw new SupplierServiceError('Supplier not found.', 'not_found');
  await updateWixDataItem('suppliers', next.id, applySupplierUpdateToWixData(existingRaw, patch));
}

/** Activity is best-effort — an audit-write failure never fails the mutation. */
async function bestEffort(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    /* swallow */
  }
}
