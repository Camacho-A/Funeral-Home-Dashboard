import type { OrganizationContext } from '../types/organization';
import type { StaffProfile } from '../types/staffProfile';
import { staffFixtures } from './__mocks__/fixtures';

export async function list(context: OrganizationContext): Promise<StaffProfile[]> {
  return staffFixtures.filter((s) => s.organizationId === context.organizationId && s.isActive);
}

export const staffService = { list };
