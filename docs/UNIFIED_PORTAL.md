# Unified portal — Manors + Gus in one SOLIS (Phase 5N, 2026-11)

**Status:** built and tested in development with fictional data only. Not
deployed, not pushed to `release/gus`, not merged. No live record, Vercel
setting or secret was read or changed.

Decision (owner, 2026-11-20): Option B. Both funeral homes stay operational,
each with its own case-number series, and authorized staff work through one
portal: the existing `gus-solis` Vercel project. Manors Production keeps
running unchanged throughout the transition, and Manors' integrations stay
there for now.

## 1. What stays the same

- One shared Beacon Wix backend. Two organizations, never flattened:
  `managed-cremations` (Manors, prefix `B`) and `gus-camacho-jr` (Gus,
  prefix `M`). No case is migrated, duplicated, renumbered, reassigned or
  deleted. Every case keeps its organization, number, documents, workflow,
  timestamps and Activity.
- Every request is still authorized per organization on the server, against
  the person's own active membership (`requireAuthorizedOrganization` /
  `resolveMembershipAuthorizationContext`), with that organization's role,
  permissions, MFA policy and deployment allowlist.

## 2. How both organizations appear in one portal

| Piece | Where | What it does |
|---|---|---|
| Organization selector | `components/layout/OrganizationSelector.tsx`, top of the sidebar (also inside the phone menu) | Shown only to people in 2+ organizations. Options: **All authorized organizations**, then each of their own organizations, as listed by the server. Choosing one asks the server to switch (membership re-checked). Choosing All switches nothing. |
| Picker after sign-in | `app/choose-organization` | Replaces the old "contact an administrator" dead end for people with 2+ organizations and none chosen. |
| "All" viewing mode | `hooks/usePortfolio.tsx` | A view preference only (remembered per browser). It is never sent to the server and grants nothing. |
| Combined Dashboard | `components/portfolio/CombinedDashboard.tsx` | Cases needing attention, upcoming services and recently updated cases, merged, with every row labelled with its funeral home. Cases by stage is shown **per organization**, because the workflows differ. Has a funeral-home filter. |
| Combined search | `components/portfolio/CombinedCaseSearch.tsx` (Dashboard and Cases page) | Searches each organization separately; results are labelled. |
| Organization-specific case address | `/o/{organizationId}/cases/{caseId}` (`app/(portal)/o/...`, `lib/auth/alignSessionOrganization.ts`) | The server checks the membership, makes that organization the working one, then opens the case under that organization's own workflow, permissions, documents and rules. Someone who isn't a member gets an access-denied page that reveals nothing. `/cases/{id}` still works for the current organization. |
| Notice on single-organization pages | `components/portfolio/CombinedViewNotice.tsx` | In All mode, says which organization a single-organization page (Tasks, Settings, a case) shows and where changes go. |
| New case | `components/portfolio/OrganizationChoiceModal.tsx` | In All mode, New Case first asks "which funeral home?". It offers only organizations that are Active and where the person's role there may create cases. The New Case form shows "For {funeral home}". |

**Why combined views are safe.** Each organization's part of a combined
page comes from that organization's own requests: the same APIs as before,
each re-authorized on the server with the person's membership there. The
list of organizations comes from the server (`/api/auth/memberships`:
active memberships, filtered to the deployment). No API accepts a list of
organizations, and "all" is never an organization (tested: `all`, `*`, a
comma list and other tenants all get 403).

**Writes.** The session always has one specific working organization, and
every write route takes one explicit organization and re-checks it. "All"
cannot reach a write.

## 3. Case numbering

Unchanged. Numbers are `{prefix}{year}-{NNN}`, per organization, with a
separate counter row per (organization, year)
(`lib/wixCaseNumberSequence.ts`), so they are unique within an
organization. A case's identity and address are organization + case id.
Combined lists always show the funeral home beside the number. New cases
are numbered by the chosen organization's rules (tested: same sequence
gives `B2026-007` and `M2026-007`).

## 4. Transition controls

`features.transitionStatus` in each organization profile, either `'active'`
or `'historical'` (`domain/organization/organizationTransition.ts`). Both
organizations are **Active**. A historical organization keeps every
existing case readable and workable, but refuses new cases: POST
`/api/cases` returns 409, the browser-side create refuses, and New Case
shows it as unavailable. Tested with a fictional historical scenario.
Making an organization historical is a separately approved profile change.

## 5. Manors integrations on the unified portal

During the transition, Manors' integrations and secrets stay on Manors
Production. The unified portal holds none of them; the start-up guard
still forbids every Manors integration key.

An audit found that even without the keys, a combined deployment could
cause real effects for Manors indirectly:

- by writing shared rows that **Manors Production's** own sweeps later act
  on (calendar sync markers, digest-queued notifications, appointment
  reminder rows);
- by **disconnecting** Manors' Outlook mailbox, or marking calendar
  connections as needing re-authorization;
- by leaving **orphaned pending payments**;
- by reporting a family-portal invitation as **sent when it wasn't**.

One gate now prevents all of these:
`lib/deployment/organizationIntegrations.ts › integrationUnavailableReason(organizationId, channel)`.
It applies only on a Gus deployment that also serves Manors, only to
Manors, and it decides from the deployment's own configuration, never
from the request. It says, in plain words, that the feature still runs
from the Manors portal and that nothing was sent or changed.

| Channel | Enforced in | On the unified portal for a Manors case |
|---|---|---|
| Outlook crematory mailbox / fax | `crematoryMailboxService` (status, access, connect, complete, disconnect) | Send to Crematory, fax bundles and fax tests refused (503); Settings shows "unavailable here"; can never disconnect Manors' mailbox |
| Calendar sync | `calendarSyncService.markPending*`, the sweep; `calendarConnectionService` (connect, disconnect, token use) | No sync markers written; Manors connections never touched |
| Appointment reminders | `appointmentReminderService.schedule…`, the sweep | No reminder rows (cancelling reminders still allowed — it can only stop a send) |
| Email / SMS notifications | `notificationService.dispatchChannel`, the digest sweep | In-app only; no email/SMS delivery row at all |
| Email (invitations, family portal, signatures) | invitations route (create and resend), portal-invitations route, `signatureService` (create and resend) | Refused before anything is created (503) |
| Payments (Clover) | `paymentsService.initiateCheckout`, `refundPaymentAtProvider` | Refused before any pending record is written |
| JotForm | `jotformReadCredentials` | No key used; nothing read |
| Document storage | `documentService` storage wrapper (keys begin with the organization id) | Nothing uploaded, read or deleted; prevents Manors files landing in the wrong store |

Also unavailable for Manors there, already failing safely:
Manatee and Certificate of Cremation templates (clear "not set up"
messages), and SSN storage (Manors' SSN key stays on Manors Production).

Known limits: appointments created or moved for Manors on the unified
portal won't reach staff calendars or send reminders until calendars and
reminders migrate. A failed document upload leaves a "failed" document row,
as it does today.

### Integration migration plan (each step separately approved)

Staff can stop using the existing Manors portal only once **all of 1–8**
are available on the unified portal:

1. **Document storage:** give the unified portal access to Manors'
   document store (the same Blob store, or a copy).
   - Until then Manors documents can't be opened there.
   - Decide store ownership first; a Hobby-plan quota is shared.
2. **Outlook crematory mailbox and fax:** register the unified portal's
   address with the Microsoft app, and share or move the token encryption
   key (`CALENDAR_TOKEN_ENCRYPTION_KEY`).
   - Re-connect the mailbox from the unified portal, then turn it off on
     Manors Production. Only one portal may send.
3. **Manatee DC application and Certificate of Cremation templates:**
   point the unified portal at the same template files.
4. **JotForm:** point Manors' JotForm webhooks at the unified portal and
   give it Manors' JotForm key.
   - Switch-over moment: the webhook can only target one host.
5. **Email (Resend) and SMS (Twilio):** a sender for the unified portal.
6. **Calendar sync and reminders:** move the sweeps. Run them on exactly
   one deployment.
7. **Clover:** the integration's environment variables on the unified
   portal.
8. **SSN key:** the same `SSN_ENCRYPTION_KEY`, or existing encrypted SSNs
   become unreadable there.

For each step, the gate's channel is lifted for Manors in code and the
start-up guard's forbidden list is narrowed in the same reviewed change.
After that, Manors Production can be retired or set to read-only.

## 6. Authentication and MFA

**One sign-in.** A person signs in once and works in every organization
they belong to, switching in the sidebar. No second sign-in, and tested:
someone in one organization can't reach the other, whatever their role at
home.

**Shared identity store.** Identities, memberships, sessions and MFA
enrollment live in shared Wix collections used by every SOLIS deployment.
Each deployment signs its own session cookies (`SESSION_JWT_SECRET`), so a
session from one is never accepted by another (tested). A person who uses
both portals during the transition has one sign-in per portal (different
hosts and secrets) but one password, because the password hash is shared.

**MFA: portal-scoped enrollment (decided 2026-11-20: the Manors MFA key is NOT copied).**

The original MFA fields on the shared identity record (`mfaEnabled`,
`mfaSecretReference`, `mfaVerifiedAt`, `mfaRecoveryCodeHashes`) belong to
the deployment that wrote them: **Manors Production**. The `gus-solis`
portal (Gus-only or unified) is **portal-scoped**
(`lib/identity/portalMfaScope.ts`). It never reads or writes those fields;
it keeps its own enrollments in a separate store
(`services/portalMfaStore.ts`).

- **Scope:** each enrollment is keyed by a portal scope id, a one-way
  digest of this portal's `MFA_ENCRYPTION_KEY`. It reveals nothing about
  the key; rotating the key starts a new scope.
- **Recovery codes:** per portal, stored only as hashes, single use.
  Regenerating needs a current authenticator code. Manors recovery codes
  are neither accepted nor consumed on the unified portal.
- **Disable:** turning MFA off on the unified portal removes only its own
  enrollment.
- **Code:** `services/mfaService.ts` (one legacy backend and one portal
  backend behind the same functions), `getMfaState`, the MFA gate in
  `resolveMembershipAuthorizationContext`, `identityMustEnrollMfa`, the
  `/api/auth/mfa/*` routes and `/mfa-setup`.

**How existing staff transition (no password-only fallback):**

| Person | On the unified portal |
|---|---|
| No MFA anywhere | Unchanged: enroll here if an organization requires it. |
| MFA set up at Manors, not here | After their password they're asked for a **one-time setup code** (`/login/mfa-setup-code`), then must connect an authenticator for this portal before anything else. Every organization refuses their session until they do. Their Manors MFA keeps working. |
| MFA set up here | Normal code prompt, using this portal's authenticator and recovery codes. |

**One-time setup codes** (`services/portalMfaSetupGrantService.ts`,
`POST /api/auth/mfa/setup-grants`, and "Issue two-step setup code" in
Settings › Team):
- **Who issues:** an administrator (`user.manageRoles`) of one of the
  person's organizations, never the person themselves.
- **Only when needed:** a code is issued only for someone with MFA
  elsewhere and none here.
- **Handling:** shown once with no-store caching; only its hash is stored.
- **Lifetime:** valid 30 minutes and single use. Issuing a new code revokes
  the earlier one. A wrong code counts toward account lockout.
- **Audit:** recorded as `identity.portal_mfa.setup_code_issued`, without
  the code.
- **Delivery:** the administrator gives it to the person in person or by
  phone (email is off).

**Live requirements (approval):** two new Wix collections,
`portalMfaEnrollments` and `portalMfaSetupGrants` (server-only, accessed
with the API key), must exist before anyone can enroll MFA on any live
`gus-solis` deployment, including the Gus-only first one. Until then this
runs on fictional data only. No live identity or MFA record is changed by
any of this.

**Legacy mode** (Manors Production, the sandboxes, local development) is
unchanged. If a deployment there ever meets an enrollment made under
another key, it fails safely and offers recovery codes.

## 7. Wix API key: can the unified portal reuse the existing key?

No secret value was viewed. Assessment from the code: the app uses one
site-level API key (`WIX_API_KEY` + `WIX_SITE_ID`, `@wix/sdk`
`ApiKeyStrategy`, plus Wix Data REST).

- **Permissions needed:** read **and write** Wix Data items in the Beacon
  site's SOLIS collections, plus reading site properties.
  - Writes are needed even for a "read-only" first deployment, because
    sign-in writes sessions, the sign-in time and a sign-in event (Phase 5M).
  - A read-only key would make sign-in impossible.
- **Technically:** yes. The existing key works for the unified portal and
  the first controlled deployment (same site, same collections).
- **Risks of reusing the Manors key:**
  - It sits in two projects, which doubles the exposure.
  - It can't be revoked for one portal without breaking the other.
  - Rotation must be coordinated across both, and Wix can't tell which
    portal made a request.
  - Above all, it is copying a Manors Production secret, which you
    prohibited without approval.
- **Does a separate key isolate anything?** It isolates the **credential**
  (separate revocation, rotation and attribution), but **not the data**.
  Wix API key permissions are per site and category, not per collection
  or row, and both portals need the same collections. Data isolation comes
  from SOLIS's per-organization authorization, which this phase keeps.
- **Rotation:**
  - With a separate key: create a new key with the same permissions, set
    it in `gus-solis` (Production, Sensitive), redeploy, verify, then
    revoke the old one. Manors is unaffected.
  - With a shared key: the same steps on both projects, with Manors
    redeployed in the same window.
- **Decided (2026-11-20):** a dedicated key for `gus-solis`, created and
  configured by you, limited to the Beacon site.
- **Minimum permissions for the approved operations:**
  - Wix Data: read, insert, update and delete items in the SOLIS
    collections. Delete is used by existing operations (report presets,
    organization role locks) and by turning off portal MFA.
  - Reading site properties.
  - Nothing else: no site design, members, payments, media management or
    account-level permissions.
- **Note:** Wix API keys are scoped by site and permission category, not by
  collection, so the app's per-organization authorization remains the data
  boundary.

## 8. Deployment implications (nothing changed live)

- **Start-up guard** (`lib/gusDeployment.ts`):
  - `gus-solis` may now serve `gus-camacho-jr` alone or together with
    `managed-cremations`, never any other organization.
  - Sign-in branding (`LOGIN_ORGANIZATION_ID`, `LOGIN_ORGANIZATION_HOSTS`)
    may only name served organizations.
  - Every Manors integration key is still forbidden.
- **First controlled deployment (Phase 5M):** **Gus-only**, decided
  2026-11-20 (`DEPLOYMENT_ORGANIZATION_IDS=gus-camacho-jr`, as configured
  today). Unified Manors access stays off until the MFA migration and the
  integration dependencies are reviewed.
  - Portal-scoped MFA applies from day one, so the two new MFA
    collections (§6) are needed before Gus staff can enroll.
  - The unified option also needs: the MFA key decision (§6), Manors
    staff knowing which features remain on the Manors portal (§5), and an
    owner decision that Manors staff may sign in there.
  - It still needs the Wix key (§7) and acceptance of the sign-in writes.
- **Gus sandbox:** unchanged (it serves Gus only, mock data).
- **Manors Production:** untouched. On it, the integration gate allows
  everything, as before.

## 9. Fictional test data

- **Sandbox-only staff** (`services/__mocks__/dualOrganizationFixtures.ts`):
  - Casey Dual: Gus Manager, Manors Office Staff.
  - Robin Dual: Manors Funeral Director, Gus Read Only.
- **Existing fictional cases:** Manors (B…) and Gus (M…, including the
  release examples M-901 to M-906).

## 10. Tests

| File | What it checks |
|---|---|
| `lib/auth/unifiedPortalAccess.test.ts` | Dual access with per-organization roles and permissions; single-organization denial both ways; "all" and other ids refused; `/o/` address switching only with a membership; cross-tenant case requests (404/403); historical mode |
| `services/unifiedPortalIntegrationGate.test.ts` | Every gated channel for Manors; Gus and other deployments unaffected; nothing written |
| `services/unifiedPortalSessionsAndNumbering.test.ts` | Session isolation; MFA under another key fails safely without overwriting; per-organization numbering |
| `components/portfolio/unifiedPortalUi.test.tsx` | Selector, new-case choice (historical / no permission disabled), combined-view notice |
| `lib/gusDeployment.test.ts` | Approved organization set; Manors keys still forbidden |
