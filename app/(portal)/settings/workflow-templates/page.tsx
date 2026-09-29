import { WorkflowTemplatesPanel } from '@/components/settings/WorkflowTemplatesPanel';

/**
 * Task #11 (2026-09, Settings organization cleanup). "Settings → Workflow
 * Templates" — previously rendered inline at the bottom of the main
 * Settings hub page, unconditionally, mixed in with the permission-gated
 * administration cards above it (see SettingsHub.tsx's own comment on
 * what moved and why). Now its own dedicated route, matching every other
 * administrative area's "card on the hub -> dedicated page" pattern. Not
 * identity-mode-gated: workflow template read/write already authorizes
 * via `requireAuthorizedOrganization` (app/api/workflow-templates/*),
 * which works identically under every AUTH_ADAPTER, matching
 * `/settings/resources`'s own precedent.
 */
export default function WorkflowTemplatesSettingsPage() {
  return (
    <div>
      <h1>Workflow Templates</h1>
      <WorkflowTemplatesPanel />
    </div>
  );
}
