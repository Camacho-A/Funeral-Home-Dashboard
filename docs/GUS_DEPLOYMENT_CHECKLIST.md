# Gus — deployment and rollback checklists (2026-11)

**Nothing here has been run.** Each step marked **[approval]** needs the
owner's explicit approval at the time. Variable values are never written in
this repository, in chat, or in logs.

## Current state (2026-11-19/20)

| Item | State |
|---|---|
| Vercel project | `gus-solis` (`prj_xUFSQTCLeRiyfGJsuMZmfpeWHcqP`), shared repo `Camacho-A/Funeral-Home-Dashboard` |
| Production branch | `release/gus` |
| Ignored Build Step | `exit 0` — every build skipped |
| Environment variables | Production (2026-11-20, approved): `SESSION_JWT_SECRET`, `MFA_ENCRYPTION_KEY`, `CRON_SECRET` (fresh, Gus-only, stored as Sensitive), `DATA_ADAPTER=wix`, `AUTH_ADAPTER=identity`, `DEPLOYMENT_ORGANIZATION_IDS` / `LOGIN_ORGANIZATION_ID` = `gus-camacho-jr`, `APP_BASE_URL=https://gus-solis.vercel.app`, `LOGIN_ORGANIZATION_HOSTS=gus-solis.vercel.app=gus-camacho-jr`. **Missing: `WIX_SITE_ID`, `WIX_API_KEY`** (owner to supply a Gus-specific key). No Blob, email, SMS, JotForm, Outlook or payment variables. |
| Node.js | 24.x (matches Manors Production) |
| Vercel Authentication | on — all deployments except custom domains (covers `gus-solis.vercel.app`) |
| Domain | `gus-solis.vercel.app` reserved for the project (no deployment yet); no custom domain |
| Deployments | only CANCELED entries from the branch pushes (never built) |
| Sandboxes | `manors-solis-sandbox`, `gus-solis-sandbox` skip `release/*`; mock data only |
| Manors Production | `manors-cremation-dashboard`, branch `master`, unchanged |

## Enforced in code (2026-11-20)

- **Start-up guard** (`lib/gusDeployment.ts`, called from `instrumentation.ts`):
  a deployment serving `gus-camacho-jr` that is Production or on live Wix
  data **refuses to start** if `DEPLOYMENT_ORGANIZATION_IDS` /
  `LOGIN_ORGANIZATION_ID` are anything but `gus-camacho-jr`, the adapters are
  not `wix` / `identity`, or any forbidden variable is set (list below).
  The sandbox (its own isolation) and mock-data previews are exempt; Manors
  is never affected. Only names (and those four non-secret values) are
  inspected — no secret is read or logged.
- **Organization isolation**: `lib/auth/gusDeploymentIsolation.test.ts`
  (mirror of the Manors test): Gus staff reach Gus with their own role;
  Manors accounts — even ones also in Gus — never reach Manors through the
  Gus deployment; mock sign-in is refused on Wix data.
- **Nothing live**: `services/gusGoLiveSwitches.test.ts`.

Forbidden on a Gus deployment until each is separately approved:
`RESEND_*`, `TWILIO_*`, `MICROSOFT_*`, `GOOGLE_*`, `CALENDAR_TOKEN_ENCRYPTION_KEY`,
`CLOVER_*`, `JOTFORM_API_KEY` (Manors' key), `JOTFORM_API_KEY_GUS_CAMACHO_JR`,
`CERTIFICATE_OF_CREMATION_TEMPLATE_*`, `MANATEE_*`, `SSN_ENCRYPTION_KEY`,
`NEXT_PUBLIC_SOLIS_SANDBOX`, `PLATFORM_ADMIN_USER_IDS`, `WIX_OAUTH_CLIENT_ID`,
`SOLIS_FD_CREDENTIALS_STORAGE`. Enabling one later means changing this list
in code on `release/gus` as part of that approval.

Not enforceable in software: that no Gus secret equals a Manors one (values
are never compared). Generate each fresh, per section B.

## A. Pre-deployment (no live effect)

1. `release/gus` points at the reviewed commit; `git log origin/master..release/gus` reviewed; no `.env*`, `.gitignore` or `design/` changes.
2. On that commit: typecheck, full lint, full tests, `DATA_ADAPTER=mock next build` all pass.
3. Code switches confirmed OFF on that commit:
   `SERVICE_PREPARATION_WIX_FIELD_ADDED`, `MEDICAL_EXAMINER_APPROVAL_LIVE_SAVING`,
   `RELEASE_FOR_CREMATION_AVAILABLE` = `false`; Gus profile
   `sendToCrematory.sendingEnabled: false`, `requireReleaseAfterService: false`.
4. Read-only check that Manors Production's project settings and latest Production deployment are unchanged (snapshot JSON kept).

## A2. Live Wix prerequisites — [approval]

- Two new collections for portal-scoped MFA (docs/UNIFIED_PORTAL.md §6):
  `portalMfaEnrollments` and `portalMfaSetupGrants`, server-only (API key).
  Without them nobody can enroll MFA on `gus-solis`.
- A dedicated Wix API key for `gus-solis`, created by the owner, limited to
  the Beacon site with the minimum permissions in docs/UNIFIED_PORTAL.md §7.
  It is never a copy of the Manors Production key.

## B. Environment (Production target only) — [approval]

Generate every secret fresh for Gus (e.g. `openssl rand -base64 48`), paste it
directly into Vercel, and never reuse a Manors value:

| Variable | Notes |
|---|---|
| `DATA_ADAPTER=wix`, `AUTH_ADAPTER=identity` | |
| `DEPLOYMENT_ORGANIZATION_IDS=gus-camacho-jr`, `LOGIN_ORGANIZATION_ID=gus-camacho-jr` | production on Wix fails closed without the first |
| `SESSION_JWT_SECRET`, `MFA_ENCRYPTION_KEY`, `CRON_SECRET` | **new, Gus-only** |
| `APP_BASE_URL`, `NEXT_PUBLIC_APP_URL`, `LOGIN_ORGANIZATION_HOSTS` | once the domain is chosen |
| `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID` (+ branding pair) | a **Gus-only** Blob store — creating it may have cost implications [approval] |
| `WIX_SITE_ID`, `WIX_API_KEY` | the shared Beacon site, with a **dedicated `gus-solis` key** (owner creates it; never the Manors key) — connecting live Wix is its own [approval] |
| `SOLIS_FD_CREDENTIALS_STORAGE=wix` | only when live credential storage is approved — and the start-up guard's list changed in code at the same time |

Leave unset: `RESEND_*`, `TWILIO_*`, `MICROSOFT_*`, `GOOGLE_*`,
`JOTFORM_API_KEY_GUS_CAMACHO_JR` (until Gus JotForm is connected),
`SSN_ENCRYPTION_KEY`, `CLOVER_*`, Manors template keys,
`NEXT_PUBLIC_SOLIS_SANDBOX`, `PLATFORM_ADMIN_USER_IDS`, `WIX_OAUTH_CLIENT_ID`,
`CALENDAR_TOKEN_ENCRYPTION_KEY` — the start-up guard refuses every one.

## C. First controlled deployment — [approval]

1. Change `gus-solis` Ignored Build Step from `exit 0` to
   `if [ "$VERCEL_GIT_COMMIT_REF" = "release/gus" ]; then exit 1; else exit 0; fi`.
2. Trigger exactly one Production build of `release/gus` (redeploy the
   latest canceled entry, or push the reviewed commit).
3. Watch the build; confirm `READY`, served from `release/gus` at the expected SHA.
4. Smoke test on the `.vercel.app` URL (behind Vercel Authentication):
   sign in as a real Gus administrator; Dashboard, a case, Settings load;
   Manors data is not visible; Send to Crematory says sending is off;
   Service readiness shows saving off; no email/SMS sent.
5. Read-only check that Manors Production is unchanged.
6. Put the filter back to `exit 0` until the next approved release, unless the owner decides otherwise.

## D. Rollback

| Situation | Action |
|---|---|
| Bad Gus build | Vercel → `gus-solis` → Deployments → promote the previous READY Production deployment (instant), then set the filter to `exit 0`. |
| No previous Gus deployment exists | Remove the domain (if attached) or set Vercel Authentication on all deployments; set the filter to `exit 0`. |
| A bad commit on `release/gus` | `git push origin <previous-sha>:release/gus --force-with-lease` **[approval]** — Production does not change until a new build is allowed. |
| Live switch causing harm | Revert the switch in code on `release/gus` (or unset the env var, e.g. `SOLIS_FD_CREDENTIALS_STORAGE`) and redeploy **[approval]**; data already written stays (append-only histories). |
| Secret exposure | Rotate the Gus secret in Vercel and redeploy; rotating `SESSION_JWT_SECRET` signs every Gus user out once. Manors is unaffected (separate secrets). |

Rollback never touches `manors-cremation-dashboard`, `master`, the sandboxes
or live Wix data.

## E. Later, each separately — [approval]

Custom domain + DNS; live Wix credentials; live credential storage; live ME
approval saving; live service-preparation saving; `RELEASE_FOR_CREMATION_AVAILABLE`;
`requireReleaseAfterService: true`; Gus crematory recipients, Outlook mailbox
and authorization-document source; `sendingEnabled: true`; JotForm.
