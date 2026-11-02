import type { PermissionKey } from '../rbac/permissionCatalog';
import { getRegisteredOrganizationProfile } from '../organization/organizationProfiles';

/**
 * Price catalog (2026-11). The one place that decides who may do what with
 * prices, enforced by every route that changes the catalog or an order
 * (services/pricingAuthorization.ts) and mirrored by the screens.
 *
 * Each organization is on one pricing permission model (its profile's
 * `pricingPermissionModel`):
 *
 * | Action                         | 'granular'                  | 'legacy' (Manors)                         |
 * |--------------------------------|-----------------------------|-------------------------------------------|
 * | view the catalog               | serviceCatalog.read         | serviceCatalog.read                       |
 * | create / edit catalog items    | serviceCatalog.edit         | serviceCatalog.edit                       |
 * | change a price                 | serviceCatalog.price        | serviceCatalog.edit (merchandise: merchandise.manage) |
 * | deactivate / reactivate        | serviceCatalog.deactivate   | serviceCatalog.edit (merchandise: merchandise.manage) |
 * | custom items on an order       | caseOrder.customItems       | caseOrder.update                          |
 * | reprice an existing order      | caseOrder.reprice           | not offered (legacy edits re-price)       |
 *
 * The 'legacy' column is exactly what each check required before this
 * module existed, so an organization on it gains and loses nothing.
 */

export type PricingAction = 'catalog.view' | 'catalog.edit' | 'catalog.price' | 'catalog.deactivate' | 'order.customItems' | 'order.reprice';

const GRANULAR: Record<PricingAction, PermissionKey> = {
  'catalog.view': 'serviceCatalog.read',
  'catalog.edit': 'serviceCatalog.edit',
  'catalog.price': 'serviceCatalog.price',
  'catalog.deactivate': 'serviceCatalog.deactivate',
  'order.customItems': 'caseOrder.customItems',
  'order.reprice': 'caseOrder.reprice',
};

/** The permission an action takes for this organization, or null when the
    action is not offered at all (repricing on the legacy model). */
export function pricingPermissionFor(
  organizationId: string,
  action: PricingAction,
  options: { merchandise?: boolean } = {},
): PermissionKey | null {
  if (getRegisteredOrganizationProfile(organizationId).features.pricingPermissionModel === 'granular') return GRANULAR[action];
  switch (action) {
    case 'catalog.view':
      return 'serviceCatalog.read';
    case 'catalog.edit':
      return 'serviceCatalog.edit';
    case 'catalog.price':
    case 'catalog.deactivate':
      return options.merchandise ? 'merchandise.manage' : 'serviceCatalog.edit';
    case 'order.customItems':
      return 'caseOrder.update';
    case 'order.reprice':
      return null;
  }
}

/** Whether the organization manages its price catalog in SOLIS at all. */
export function isPriceCatalogManaged(organizationId: string): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.priceCatalogManagement;
}

/** Whether edits keep each existing line's agreed price (see the profile). */
export function isOrderLinePriceLocked(organizationId: string): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.orderLinePriceLock;
}
