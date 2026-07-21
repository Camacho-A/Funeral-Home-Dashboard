import { AppShell } from '@/components/layout/AppShell';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
