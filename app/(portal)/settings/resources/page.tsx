import { ResourceManagementPanel } from '@/components/settings/ResourceManagementPanel';

/**
 * Phase 27 (Scheduling & Resource Management). "Settings > Resources" —
 * unlike `/settings/team`/`/settings/roles`/`/settings/audit`/
 * `/settings/document-templates`, this page is not identity-mode-gated:
 * resource management authorizes via `requireAuthorizedOrganization` +
 * `resource.manage`/`schedule.read` (RBAC), which works identically under
 * every `AUTH_ADAPTER`, not `requireIdentitySession`.
 */
export default function ResourcesSettingsPage() {
  return (
    <div>
      <h1>Resources</h1>
      <ResourceManagementPanel />
    </div>
  );
}
