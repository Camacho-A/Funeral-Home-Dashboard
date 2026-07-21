import { AppShell } from '@/components/layout/AppShell';
import { CaseSearchProvider } from '@/hooks/useCaseSearch';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <CaseSearchProvider>
      <AppShell>{children}</AppShell>
    </CaseSearchProvider>
  );
}
