import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadInventory } from '@/services/authorizationPolicyService';
import { listBalancesForOrganization } from '@/services/inventoryService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 35. Inventory stock levels by (product, location) for the whole
    organization — the Settings → Inventory screen's data. inventory.read. */
export async function GET(request: Request) {
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadInventory({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view inventory for this organization.' }, { status: 403 });
  }
  const balances = await listBalancesForOrganization(organizationId, dataAdapterMode);
  return NextResponse.json({ balances });
}
