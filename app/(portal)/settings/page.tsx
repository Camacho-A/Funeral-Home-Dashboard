import { getAuthAdapterMode } from '@/lib/env';
import { SettingsHub } from './SettingsHub';

/**
 * Item #5 (2026-09, navigation cleanup). This route's own workflow-template
 * content (Phase 18) is unchanged — see SettingsHub.tsx. Converted to a thin
 * Server Component wrapper purely to resolve `authAdapterMode` server-side
 * (an env-derived value never available in a Client Component bundle) and
 * hand it down, the same trusted-server-value pattern
 * app/(portal)/layout.tsx already uses for AppShell/TopBar/Sidebar.
 */
export default function SettingsPage() {
  const authAdapterMode = getAuthAdapterMode();
  return <SettingsHub authAdapterMode={authAdapterMode} />;
}
