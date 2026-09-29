/**
 * SOLIS-wide ALL-CAPS data standard (2026-09). Settings → Organization
 * Profile's own explicit normalization policy — mirrors
 * `domain/cases/textNormalization.ts`/`domain/merchandise/textNormalization.ts`'s
 * exact "explicit field allowlist, never a blanket sweep" approach.
 *
 * `name`/`legalName` are staff-entered business names (prose) — uppercased.
 * `primaryEmail`/`primaryPhone`/`website` are deliberately excluded and
 * never touched: emails and URLs are case-sensitive/conventionally
 * lowercase, and phone numbers are never uppercased anywhere in this
 * codebase (see that file's own comment on `nextOfKinPhone`/
 * `certifierPhone`).
 */
export function normalizeOrganizationProfileTextFields<T extends { name?: unknown; legalName?: unknown }>(input: T): T {
  const result: Record<string, unknown> = { ...input };
  if (typeof result.name === 'string') result.name = result.name.toUpperCase();
  if (typeof result.legalName === 'string') result.legalName = result.legalName.toUpperCase();
  return result as T;
}

/**
 * Primary Location's own policy. `name`/`addressLine1`/`addressLine2`/
 * `city`/`state`/`country` are prose/address text — uppercased, the same
 * treatment Case's `placeOfDeath` already gets. `postalCode` follows
 * `tagNumber`/`shippingTrackingNumber`'s existing precedent (a physical
 * code, not prose, with no interoperability problem ever identified from
 * uppercasing it). `locationType` (a machine enum) and `phone`/`email`
 * are deliberately excluded, same reasoning as the Organization fields
 * above.
 */
const UPPERCASE_LOCATION_FIELDS = ['name', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country'] as const;

export function normalizePrimaryLocationTextFields<
  T extends Partial<Record<(typeof UPPERCASE_LOCATION_FIELDS)[number], unknown>>,
>(input: T): T {
  const result: Record<string, unknown> = { ...input };
  for (const field of UPPERCASE_LOCATION_FIELDS) {
    if (typeof result[field] === 'string') result[field] = (result[field] as string).toUpperCase();
  }
  return result as T;
}
