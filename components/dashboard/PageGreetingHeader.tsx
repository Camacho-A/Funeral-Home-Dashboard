'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/hooks/useSession';
import styles from './PageGreetingHeader.module.css';

function timeOfDayGreeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** `Session.displayName` is a full name (e.g. "Dana Reyes") — there is no
    separate first-name field anywhere in the auth/session system. Takes
    the first whitespace-separated token; '' (no session, or a session
    with an empty displayName) falls back to the plain time-of-day
    greeting with no name at all, never an email or id. */
function firstNameFrom(displayName: string): string {
  const trimmed = displayName.trim();
  return trimmed ? trimmed.split(/\s+/)[0] : '';
}

/**
 * `todayLabel` is computed by the page (app/(portal)/dashboard/page.tsx),
 * not here — the prototype hardcodes a fake date ("Wednesday, July 15");
 * this shows the real current date instead (a deliberate, documented
 * deviation), computed client-side after mount to avoid baking a stale
 * build-time date into this statically-prerendered route.
 *
 * Manors cleanup phase (Task #6, personalized greeting). The greeting
 * itself previously had no time-of-day logic at all — "Good afternoon"
 * was a hardcoded literal, always shown regardless of the actual time.
 * Both the time-of-day text and the current user's first name (from
 * `useSession()`, the same session already powering the TopBar's own
 * employee-name display) are now computed here, client-side after mount —
 * mirroring `todayLabel`'s own established pattern exactly, so the
 * server-rendered HTML and the client's first paint never disagree about
 * the visitor's local clock.
 *
 * SOLIS true redesign, Phase 1 (2026-10). Dropped the "· N active cases"
 * suffix from the subtitle, per the approved design's own plain
 * "{greeting}" / "{date}" header — Active cases now has its own cell in
 * the Dashboard's KPI strip (DashboardKpiStrip.tsx) directly below, so
 * repeating the same number here was redundant, not a second source of
 * truth removed from anywhere real.
 */
export function PageGreetingHeader({ todayLabel }: { todayLabel: string }) {
  const { displayName } = useSession();
  const [greeting, setGreeting] = useState('');

  useEffect(() => {
    setGreeting(timeOfDayGreeting(new Date().getHours()));
  }, []);

  const firstName = firstNameFrom(displayName);
  const title = firstName ? `${greeting}, ${firstName}` : greeting;

  return (
    <div className={styles.wrapper}>
      <div className={styles.title}>{title}</div>
      <div className={styles.subtitle}>{todayLabel}</div>
    </div>
  );
}
