import type { DataAdapterMode } from '../lib/env';
import { hasPermission, type ResolvePermissionsParams } from './permissionService';
import { pricingPermissionFor, type PricingAction } from '../domain/pricing/pricingPermissions';

export { isOrderLinePriceLocked, isPriceCatalogManaged, pricingPermissionFor, type PricingAction } from '../domain/pricing/pricingPermissions';

/** Server-side check of a pricing action — see domain/pricing/pricingPermissions.ts. */
export async function canPerformPricingAction(
  params: ResolvePermissionsParams,
  dataAdapterMode: DataAdapterMode,
  action: PricingAction,
  options: { merchandise?: boolean } = {},
): Promise<boolean> {
  const key = pricingPermissionFor(params.organizationId, action, options);
  if (!key) return false;
  return hasPermission(params, dataAdapterMode, key);
}
