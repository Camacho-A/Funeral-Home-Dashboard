'use client';

import { usePathname, useRouter } from 'next/navigation';
import { familyLogout } from '@/lib/familyClient';
import { useFamilyUnreadNotificationCount } from '@/hooks/useFamilyNotifications';
import styles from './FamilyShell.module.css';

const NAV_ITEMS = [
  { href: '/family/dashboard', label: 'Home' },
  { href: '/family/notifications', label: 'Notifications' },
  { href: '/family/profile', label: 'Profile' },
];

/**
 * Phase 29 (Family Portal & External Collaboration). The mobile-first
 * chrome every authenticated `/family/*` page renders inside — a top bar
 * (title + sign out) and a bottom tab bar (the surface's own three
 * top-level destinations: dashboard, notifications, profile; a case's own
 * sub-pages are reached from the dashboard/case detail, not from here).
 * Deliberately its own component, never reusing the staff `AppShell` —
 * that shell is fixed-width/desktop-only by design (see
 * docs/UI_COMPONENTS.md), while this one is built mobile-first from the
 * start, matching the approved plan's own instruction.
 */
export function FamilyShell({ displayName, children }: { displayName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const unreadCount = useFamilyUnreadNotificationCount();

  async function handleSignOut() {
    await familyLogout();
    router.push('/family/login');
    router.refresh();
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <span className={styles.title}>Family Portal</span>
        <div className={styles.topBarRight}>
          <span className={styles.displayName}>{displayName}</span>
          <button type="button" className={styles.signOut} onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </header>

      <main id="main-content" className={styles.content}>
        {children}
      </main>

      <nav className={styles.bottomNav} aria-label="Family Portal navigation">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/family/dashboard' && pathname?.startsWith(item.href));
          return (
            <a key={item.href} href={item.href} className={isActive ? styles.navItemActive : styles.navItem}>
              {item.label}
              {item.href === '/family/notifications' && unreadCount.isSuccess && unreadCount.data > 0 && (
                <span className={styles.badge}>{unreadCount.data > 9 ? '9+' : unreadCount.data}</span>
              )}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
