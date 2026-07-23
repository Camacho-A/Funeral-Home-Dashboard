'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './SidebarNavItem.module.css';

/**
 * A single sidebar nav row. Uses a real Next.js <Link> (App Router
 * navigation) rather than the prototype's onClick-driven fake nav — the
 * prototype was a single-page view switch with no URLs; this version has
 * real routes, so real links are the correct, idiomatic replacement.
 */
export function SidebarNavItem({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link href={href} className={`${styles.item} ${isActive ? styles.itemActive : ''}`}>
      {label}
    </Link>
  );
}
