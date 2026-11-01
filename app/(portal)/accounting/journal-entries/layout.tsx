import { guardHiddenModulePage } from '@/lib/auth/hiddenModulePageGuard';

/** Direct-URL protection for an organization that hides this Accounting
    area (lib/auth/hiddenModulePageGuard.ts) — navigation hiding alone is
    not enough. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await guardHiddenModulePage('accounting-journal-entries');
  return <>{children}</>;
}
