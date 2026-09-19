'use client';

import { createContext, useContext } from 'react';
import type { Session } from '@/types/session';

export type { Session };

/**
 * Manors go-live fix (2026-09). Replaces the old hardcoded
 * `staffFixtures[0]` ("Dana") stub — every real Manors employee saw that
 * name in the TopBar avatar, the New Case "your name" display, and every
 * `performedBy`/`uploadedBy` field sent from a client mutation, regardless
 * of who was actually logged in.
 *
 * Mirrors `hooks/useOrganization.tsx`'s exact Context/Provider shape:
 * `app/providers.tsx` mounts a harmless default (`staffId: null`, empty
 * displayName) for routes with no session at all (e.g. `/login`);
 * `app/(portal)/layout.tsx` — which already resolves the real,
 * authenticated session/membership server-side on every request —
 * re-mounts this with the real value, sourced from
 * `services/staffProfileService.ts#resolveStaffProfileForCaller` (the
 * same function every server route already trusts for this) and the real
 * `AuthSession.user.displayName` (present for every auth mode). No new
 * server-side resolution logic was invented for this — it reuses what
 * already existed.
 */
export const DEFAULT_SESSION: Session = { staffId: null, displayName: '' };

const SessionContext = createContext<Session>(DEFAULT_SESSION);

export function SessionProvider({ value, children }: { value: Session; children: React.ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * The only sanctioned way to read "who is the currently authenticated
 * staff member" client-side — no component may hardcode or otherwise
 * derive this from a fixture. `staffId` is `null` when the real,
 * authenticated identity has no `StaffProfile` provisioned yet in this
 * organization (a real, disclosed possibility — see `types/session.ts`'s
 * own comment); `displayName` is always the real signed-in person's name.
 */
export function useSession(): Session {
  return useContext(SessionContext);
}
