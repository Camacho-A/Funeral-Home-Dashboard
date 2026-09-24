/**
 * SOLIS-wide ALL-CAPS data standard (2026-09). MerchandiseProduct's own
 * explicit normalization policy — `name`, `description`, and `supplierName`
 * are staff-entered prose; `sku` (a stable machine identifier),
 * `cost`/`retailPrice` (numeric), `category` (enum), and every id field are
 * deliberately excluded and never touched by this function.
 *
 * Deliberately does NOT touch `CaseOrderLineItem.description` — that field
 * is copied verbatim from a product's `name` at calculation time
 * (services/pricingService.ts), so it inherits its capitalization from
 * this normalization at the moment the catalog snapshot is taken, rather
 * than being independently re-normalized as an immutable historical
 * snapshot.
 */
export function normalizeMerchandiseTextFields<T extends { name?: unknown; description?: unknown; supplierName?: unknown }>(
  input: T,
): T {
  const result: Record<string, unknown> = { ...input };
  if (typeof result.name === 'string') result.name = result.name.toUpperCase();
  if (typeof result.description === 'string') result.description = result.description.toUpperCase();
  if (typeof result.supplierName === 'string') result.supplierName = result.supplierName.toUpperCase();
  return result as T;
}
