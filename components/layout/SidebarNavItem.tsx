'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './SidebarNavItem.module.css';

/**
 * A single sidebar nav row. Uses a real Next.js <Link> (App Router
 * navigation) rather than the prototype's onClick-driven fake nav — the
 * prototype was a single-page view switch with no URLs; this version has
 * real routes, so real links are the correct, idiomatic replacement.
 *
 * Mobile navigation drawer (2026-09): `onNavigate` is new, optional, and
 * has no effect on desktop — the Sidebar passes its own `onClose` through
 * here so tapping any link also closes the mobile drawer, instead of
 * leaving staff to navigate underneath it. Nothing about desktop's
 * always-visible Sidebar calls this.
 */
export function SidebarNavItem({
  href,
  label,
  onNavigate,
}: {
  href: string;
  label: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link href={href} className={`${styles.item} ${isActive ? styles.itemActive : ''}`} onClick={onNavigate}>
      {label}
    </Link>
  );
}
