# MFA enrollment gate (2026-11)

Closes audit finding **B5** (docs/MULTI_TENANT_AUDIT.md): a member of an
organization that requires MFA, who had not enrolled yet, received a full
session at sign-in and only a *redirect* to the security page — every API
still answered them. A stolen password of a not-yet-enrolled member was
therefore enough to read and change case data.

Branch `feat/p3-mfa-gate` (from `feat/price-catalog` 4537a06). **Not
deployed. Authentication change — Production rollout needs approval.**

## Design

**Enforced in the one central authorization path, from server-side data.**

- `lib/auth/resolveMembershipAuthorizationContext.ts` — every organization
  grant for an identity session passes through it: `requireAuthorizedOrganization`
  (all org-scoped API routes), the RBAC / invitations / activity /
  document-template / wix-health routes, `switch-organization`, the portal
  layout and the hidden-module page guard. After membership is granted for
  organization X it checks: *X requires MFA* and *the identity row says not
  enrolled* → refused with reason `mfa_enrollment_required`. No route can
  forget it; there is no client flag to forge (the cookie carries no MFA state,
  and extra cookie fields are ignored).
- **Per organization.** Only the organization being accessed is checked. A
  member of a home that does not require MFA is never affected by another home
  that does (`identityMustEnrollMfa` — "any membership" — is still used only to
  decide where to send someone right after sign-in).
- **Order of checks preserves isolation.** The policy is read only *after*
  membership is granted, so a non-member asking about another organization
  gets the same generic 403 as before and learns nothing about its MFA
  policy; enrollment in one organization never grants another (membership is
  unchanged).
- **Responses.** API: `403 {"error":"Set up two-factor authentication to continue.","code":"mfa_enrollment_required","setupPath":"/mfa-setup"}`.
  Pages: the portal layout redirects to `/mfa-setup`. Sign-in of such a member
  now redirects to `/mfa-setup?next=…` (was `/settings/security`, which is
  inside the portal and so now unreachable for them).
- **What stays reachable** (identity-only routes, no organization grant):
  `/api/auth/mfa/*` (begin/verify/status), sessions, sign-out, change
  password, memberships list. `/mfa-setup` lives outside the portal layout,
  needs a valid session (middleware + `resolveIdentitySession`), shows no
  organization data, and sends an already-enrolled identity on to `next`
  (same-site paths only).
- **Effective immediately.** As soon as enrollment verifies, the identity row
  says enrolled and the next request passes — no new sign-in needed. MFA is
  only on after a TOTP code verifies; an interrupted setup simply starts again
  (a new setup key replaces the unverified one).
- **Performance.** An enrolled identity costs nothing extra. For a
  not-yet-enrolled identity the organization's `requireMfa` is read once and
  cached for 30 s per process (`ORGANIZATION_MFA_POLICY_TTL_MS`), so a typical
  request stays one Wix round-trip. Consequence: turning the policy **on**
  takes effect within 30 s on other server instances (immediately on the one
  that saved it). A failed policy read fails the request (closed), never
  lets it through.
- MFA stays separate from RBAC: no permission is checked or granted by the
  gate.

## Files

`services/mfaPolicyService.ts` (organizationRequiresMfa, mfaEnrollmentRequiredFor, cache),
`lib/auth/resolveMembershipAuthorizationContext.ts` (the gate),
`lib/auth/requireAuthorizedOrganization.ts` (403 response),
`app/(portal)/layout.tsx`, `app/login/actions.ts`, `app/api/auth/switch-organization/route.ts`,
`app/api/organization/mfa-policy/route.ts` (cache cleared on change),
call sites passing the already-loaded identity (rbac, invitations, activity,
document-templates, wix-health, hiddenModulePageGuard),
`app/mfa-setup/page.tsx`, `components/auth/MfaEnrollmentSetup.tsx`.

Tests: `lib/auth/mfaEnrollmentGate.test.ts` (enrolled unaffected; new invitee
blocked then admitted without re-sign-in; identity-session routes and implicit
selection blocked; enrollment endpoints reachable; optional org unaffected;
incomplete and interrupted enrollment; forged cookie claim; per-organization;
no cross-org grant or policy disclosure; fail-closed on read failure),
`app/(portal)/layout.test.tsx`, `app/login/actions.test.ts`,
`app/mfa-setup/page.test.tsx`, `components/auth/MfaEnrollmentSetup.test.tsx`,
`lib/auth/authPerformance.test.ts` (round-trip counts).

## Rollout impact on live users

Who is affected is decided entirely by each live Organization record's
`requireMfa` (Wix `organizations` collection), which this work could not read
(no live access in this phase):

- **Organization with `requireMfa` absent/false** (expected for Manors unless
  an administrator turned it on in Settings → Security): **no change** for any
  member, enrolled or not. The only difference is one cached policy read per
  30 s for not-yet-enrolled members.
- **Organization with `requireMfa: true`**: every member who has not enrolled
  is, on their **next request** (not only next sign-in), sent to `/mfa-setup`
  and refused by the APIs until they enroll. Already-enrolled members are
  unaffected. Today those members are already redirected to Security at each
  sign-in, so the visible change is that they can no longer skip it.

**Before rollout:** read (read-only) each live organization's `requireMfa`,
and for any that is true list its members with `mfaEnabled: false` — they
must be told to have their phone/authenticator ready.

## Known limit (unchanged by this work)

Enrollment at first use means whoever holds a not-yet-enrolled member's
password can enroll their own authenticator. The gate stops that person from
reaching data *without* enrolling; it cannot tell them apart from the real
member. Mitigation is operational: invite-only accounts, enroll on day one,
and an administrator resetting MFA on any account reported as not set up by
its owner.

## Rollout (needs approval) and rollback

1. Approve; merge with the release branch; deploy as part of the normal
   release (no schema change, no data change, no new env var).
2. Smoke test on Production with a fictional/test member of an organization
   requiring MFA: blocked → enroll → admitted; and with an enrolled member.
3. **Rollback:** redeploy the previous Production deployment (Vercel
   "Promote" of the prior build) — nothing persistent changes, so rollback is
   complete. Emergency relief without a deploy: an administrator turns off
   "Require MFA" for the organization (takes effect within 30 s).
