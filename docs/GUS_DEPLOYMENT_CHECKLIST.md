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
| Environment variables | none |
| Domain | none (no deployment, so no `.vercel.app` alias assigned) |
| Deployments | only CANCELED entries from the branch pushes (never built) |
| Sandboxes | `manors-solis-sandbox`, `gus-solis-sandbox` skip `release/*`; mock data only |
| Manors Production | `manors-cremation-dashboard`, branch `master`, unchanged |

## A. Pre-deployment (no live effect)

1. `release/gus` points at the reviewed commit; `git log origin/master..release/gus` reviewed; no `.env*`, `.gitignore` or `design/` changes.
2. On that commit: typecheck, full lint, full tests, `DATA_ADAPTER=mock next build` all pass.
3. Code switches confirmed OFF on that commit:
   `SERVICE_PREPARATION_WIX_FIELD_ADDED`, `MEDICAL_EXAMINER_APPROVAL_LIVE_SAVING`,
   `RELEASE_FOR_CREMATION_AVAILABLE` = `false`; Gus profile
   `sendToCrematory.sendingEnabled: false`, `requireReleaseAfterService: false`.
4. Read-only check that Manors Production's project settings and latest Production deployment are unchanged (snapshot JSON kept).

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
| `WIX_SITE_ID`, `WIX_API_KEY` | the shared Beacon site — connecting live Wix is its own [approval] |
| `SOLIS_FD_CREDENTIALS_STORAGE=wix` | only when live credential storage is approved |

Leave unset: `RESEND_*`, `TWILIO_*`, `MICROSOFT_*`, `GOOGLE_*`,
`JOTFORM_API_KEY_GUS_CAMACHO_JR` (until Gus JotForm is connected),
`SSN_ENCRYPTION_KEY`, `CLOVER_*`, Manors template keys,
`NEXT_PUBLIC_SOLIS_SANDBOX`.

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
