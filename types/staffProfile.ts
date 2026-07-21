/**
 * Matches docs/CMS_SCHEMA.md's StaffProfiles collection. `role` is carried
 * here per docs/USER_ROLES.md even though no screen in the approved V1 scope
 * enforces role-based UI differences yet — RBAC enforcement is a
 * backend-integration-phase concern (docs/ARCHITECTURE.md), not something
 * this frontend-only phase needs to act on.
 */
export type StaffRole = 'admin' | 'funeral_director' | 'staff';

export type StaffProfile = {
  id: string;
  organizationId: string;
  displayName: string;
  role: StaffRole;
  isActive: boolean;
};
