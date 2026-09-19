/**
 * The trusted, authenticated-user context — distinct from OrganizationContext
 * (which tenant), this is *who*. Obtained only via useSession() (see
 * hooks/useSession.ts), never accepted as client-editable form input. Lives
 * in types/ rather than hooks/ so services/ can depend on it without
 * inverting the domain → services → hooks → components layering
 * (services/casesService.ts needs this shape for intake-owner derivation;
 * it must not import from hooks/).
 *
 * Manors go-live fix (2026-09): `useSession()` is now backed by the real
 * authenticated session (`app/(portal)/layout.tsx`, via
 * `services/staffProfileService.ts#resolveStaffProfileForCaller` — the
 * same function every server route already trusts), never a hardcoded
 * mock fixture. `staffId` is nullable because a real, fully authenticated
 * identity/membership may not yet have a `StaffProfile` row provisioned
 * (no code path auto-creates one today) — `displayName` always comes
 * from the real `AuthSession.user.displayName`, which every auth mode
 * (mock/wix/identity) already carries, so it's never empty for a real
 * logged-in user regardless of `staffId`.
 */
export type Session = {
  staffId: string | null;
  displayName: string;
};
