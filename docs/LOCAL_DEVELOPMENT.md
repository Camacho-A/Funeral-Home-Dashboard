# Local development (Manors / SOLIS)

Run SOLIS locally with the real identity login and RBAC over **fictional**
in-repo demo data. Nothing touches the network: no Wix, JotForm, Clover,
email/SMS or Vercel calls are made.

## Quick start (mock data)

1. Create `.env.local` (it is gitignored, never commit it) with:

   ```bash
   DATA_ADAPTER=mock
   AUTH_ADAPTER=identity
   DEPLOYMENT_ORGANIZATION_IDS=managed-cremations
   # Optional locally (dev fallbacks exist), required in production:
   # SESSION_JWT_SECRET=<random>
   # APP_BASE_URL=http://localhost:3000
   ```

2. `npm install`, then `npm run dev`, then open http://localhost:3000.
3. Sign in with Manors' demo administrator (`MOCK_LOGIN_EMAIL` from
   `services/__mocks__/authFixtures.ts`, password `MANORS_ADMIN_DEMO_PASSWORD`
   from `services/__mocks__/identityFixtures.ts`). In development only, the
   login card shows this as a "Local demo data" hint.

**Real Wix data locally** (`DATA_ADAPTER=wix`) now requires
`AUTH_ADAPTER=identity` — the old `DATA_ADAPTER=wix` + `AUTH_ADAPTER=mock`
combination is refused, because mock memberships must never authorize access
to shared, multi-tenant data. Real data also means real customers: prefer
mock data for development.

## Gus Camacho demo tenant (second organization)

All demo accounts are defined in `services/__mocks__/gusFixtures.ts`. They
all share the password constant `GUS_DEMO_PASSWORD` from that file. The
password is a fixed demo value that exists only in mock data.

| Constant            | Role (role model key) | Purpose                                  |
| ------------------- | --------------------- | ---------------------------------------- |
| `GUS_ADMIN_EMAIL`   | `administrator`       | Full access: every portal area           |
| `GUS_DIRECTOR_EMAIL`| `funeralDirector`     | Day-to-day case work                     |
| `GUS_VIEWER_EMAIL`  | `readOnly`            | Read-only check of permission gating     |

Permissions are never granted by the fixtures. Each account has one
membership, only in `gus-camacho-jr`, and its permissions come from the
platform-default role definitions (`domain/rbac/defaultRoles.ts`) through
`services/permissionService.ts`, exactly as in production.
`services/__mocks__/gusFixtures.test.ts` checks that the administrator can
reach Dashboard, Cases, Case Details, Documents, Accounting, Staff
Management, Roles, Security, Document Templates, Audit Center, Settings,
Reports, Calendar and Notifications. It also checks that the read-only
account has none of the administrative permissions.

The cross-tenant isolation tests use this tenant to prove the Manors
deployment (`DEPLOYMENT_ORGANIZATION_IDS=managed-cremations`) refuses Gus
accounts and Gus data, and vice versa.

### What the Gus demo data contains

- Organization `gus-camacho-jr`, "Gus Camacho Jr. Funeral Home", active,
  case number prefix `M`. It has no logo, address, phone or license number:
  real values are configured by the funeral home through Settings on the real
  deployment and are never invented here.
- Gus' own copy of the standard cremation workflow (same stages, checklists
  and intake as Manors' current template, with no link to Manors' JotForm
  integration).
- Demo cases numbered `M<current year>-001`, `-002`, and so on. The year and
  dates come from the current date, so the data always looks recent. The
  cases are spread across every workflow stage, and some are stalled, so the
  dashboard's "Cases by stage" and "Needs attention" both have content.
- Fictional families only: "EXAMPLE DECEDENT …" names, `(555) 010-01xx`
  phone numbers and `@example.test` email addresses, none of which can reach
  anyone.
- The seven default roles enabled for Gus, plus a few demo tasks.

## How mock data behaves

- Every mock collection lives in memory in the dev-server process, anchored
  on `globalThis` by `services/__mocks__/mockStore.ts`. `next dev` evaluates
  modules more than once: the login Server Action and the page render can
  run in different module instances. Without the shared store, a session
  created at login could not be found on the next page, and the user was
  sent back to `/login`.
- Edits you make (case updates, new sessions, role changes) last until the
  dev server restarts. **Restart `npm run dev` to reset the demo data.** You
  also need a restart after editing a fixture file, because hot reload keeps
  the existing in-memory data on purpose.
- Some client-side mock paths (for example, creating a case in mock mode)
  write into the browser's own copy of the fixtures. Those changes last until
  the page reloads.
- The store is only reached through the services' mock branches. With
  `DATA_ADAPTER=wix` nothing reads it.
- Vitest runs each test file in its own isolated worker, so mock state never
  leaks between test files. Tests that change fixtures already snapshot and
  restore them, and `resetMockStore()` is available when a test needs a
  fresh store.

## Why there is no network access

Local development and the test suite must never read or write a real
funeral home's data, send a real email or text, or charge a card. Mock data
mode makes that structural, not a matter of discipline:

- `DATA_ADAPTER=mock` sends every service call to in-repo fixtures. No Wix
  credentials are needed or read.
- Mock and Wix-Members logins are refused with `DATA_ADAPTER=wix`
  (`isNonIdentityAuthorizationPermitted`), so mock memberships can never
  authorize access to real, shared Wix data.
- Outbound integrations (email/SMS senders, JotForm, Clover, calendar
  providers) use their development fallbacks or report "not configured"
  when their credentials are unset.

## Sessions that stop working

If a session cookie becomes invalid (revoked, expired, password changed,
registry row gone after a dev-server restart, or a mock-login cookie
presented to a deployment on real data), the portal layout redirects to
`GET /api/auth/clear-session?reason=…`. That route handler deletes the cookie
and redirects to `/login?error=…`, because a Server Component cannot change
cookies during render. The handler only redirects to the fixed path
`/login`, accepts only allowlisted reasons, and never deletes a cookie that
is still valid.

## Running as Gus instead

Set `LOGIN_ORGANIZATION_ID=gus-camacho-jr` and
`DEPLOYMENT_ORGANIZATION_IDS=gus-camacho-jr`, restart `npm run dev`, and sign
in with `GUS_ADMIN_EMAIL` / `GUS_DEMO_PASSWORD` from
`services/__mocks__/gusFixtures.ts`.
