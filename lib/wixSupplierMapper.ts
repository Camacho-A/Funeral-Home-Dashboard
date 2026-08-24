import type { Supplier } from '../types/supplier';

/**
 * Phase 36 (Procurement & Accounts Payable). The one place a raw Wix
 * `suppliers` item is touched. `mapWixSupplierItem` returns null on any type
 * mismatch (a bad row drops rather than corrupting a read). See
 * docs/adr/ADR-040-procurement-and-accounts-payable.md.
 */
export type WixSupplierItem = {
  beaconSupplierId?: unknown;
  organizationId?: unknown;
  name?: unknown;
  contactName?: unknown;
  email?: unknown;
  phone?: unknown;
  addressText?: unknown;
  paymentTermsDays?: unknown;
  defaultExpenseAccountNumber?: unknown;
  notes?: unknown;
  isActive?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const n = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export function mapWixSupplierItem(item: WixSupplierItem | undefined): Supplier | null {
  if (
    !item ||
    typeof item.beaconSupplierId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.isActive !== 'boolean' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: item.beaconSupplierId,
    organizationId: item.organizationId,
    name: item.name,
    contactName: s(item.contactName),
    email: s(item.email),
    phone: s(item.phone),
    addressText: s(item.addressText),
    paymentTermsDays: n(item.paymentTermsDays),
    defaultExpenseAccountNumber: s(item.defaultExpenseAccountNumber),
    notes: s(item.notes),
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixSupplierData(supplier: Supplier): WixSupplierItem {
  return {
    beaconSupplierId: supplier.id,
    organizationId: supplier.organizationId,
    name: supplier.name,
    contactName: supplier.contactName,
    email: supplier.email,
    phone: supplier.phone,
    addressText: supplier.addressText,
    paymentTermsDays: supplier.paymentTermsDays,
    defaultExpenseAccountNumber: supplier.defaultExpenseAccountNumber,
    notes: supplier.notes,
    isActive: supplier.isActive,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

export function applySupplierUpdateToWixData(
  existing: WixSupplierItem,
  patch: Partial<Pick<Supplier, 'name' | 'contactName' | 'email' | 'phone' | 'addressText' | 'paymentTermsDays' | 'defaultExpenseAccountNumber' | 'notes' | 'isActive' | 'updatedAt'>>,
): WixSupplierItem {
  const next: WixSupplierItem = { ...existing };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.contactName !== undefined) next.contactName = patch.contactName;
  if (patch.email !== undefined) next.email = patch.email;
  if (patch.phone !== undefined) next.phone = patch.phone;
  if (patch.addressText !== undefined) next.addressText = patch.addressText;
  if (patch.paymentTermsDays !== undefined) next.paymentTermsDays = patch.paymentTermsDays;
  if (patch.defaultExpenseAccountNumber !== undefined) next.defaultExpenseAccountNumber = patch.defaultExpenseAccountNumber;
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.isActive !== undefined) next.isActive = patch.isActive;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
