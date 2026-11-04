# Vercel deployment isolation — plan (2026-11-03)

Status: **plan only.** Nothing in Vercel has been changed. Every step in §3
needs the owner's approval before it is applied. Inspection was read-only
(`vercel api` GETs; environment variable **names and targets only** — no
values were read).

## 1. What is deployed today (verified 2026-11-03)

| Project | Git link | Production branch | Ignored build step | Domains | Data |
|---|---|---|---|---|---|
| `manors-cremation-dashboard` | `Camacho-A/Funeral-Home-Dashboard` | `master` | none | `solis.manorscremation.com`, `beacon.manorscremation.com` (→ solis), `manors-cremation-dashboard.vercel.app` | **live** Wix, Resend, Twilio, Clover (sandbox), Microsoft, Google, R2, Blob |
| `manors-solis-sandbox` | same repo | `master` | none | `manors-solis-sandbox.vercel.app` | mock (9 vars, no live credentials) |
| `gus-solis-sandbox` | same repo | `master` | none | `gus-solis-sandbox.vercel.app` | mock (9 vars, no live credentials) |
| `gus-solis-preview` | **legacy** `Camacho-A/Gus-Camacho-Funeral-SOLIS` | `master` | builds only `phase-2/onboarding-prep` | `gus-solis-preview.vercel.app` | demo KV store — legacy, **left untouched** |

Observed behaviour:

- Every push to `master` deployed to Production in **all three** shared-repo
  projects (e.g. `88b2b67`, `bdc6578`, `f718d66` each appear as a
  Production deployment in each project). The sandboxes'
  `gitProviderOptions.createDeployments: disabled` only turns off GitHub
  deployment *statuses*; it does not stop builds.
- Every pushed branch builds a Preview in all three projects (the
  `feat/price-catalog` push of `4537a06` on 2026-11-03 queued a Preview in
  each, including `manors-cremation-dashboard`).
- Manors Preview deployments are behind Vercel Authentication
  (`ssoProtection: all_except_custom_domains`) — only team members can open
  them. This is the one mitigation in place today.
- `vercel.json` crons apply to every project's Production deployment. The
  cron routes are POST-only today (Vercel Cron's GET gets 405) and each
  sweep processes only `DEPLOYMENT_ORGANIZATION_IDS`, so a new Gus project
  would not touch Manors' data through them.

### Live credentials reachable from Manors **Preview** (priority)

Targets `preview` **and** `production` share the same value for:
`WIX_API_KEY`, `WIX_SITE_ID`, `WIX_ACCOUNT_ID`, `WIX_OAUTH_CLIENT_ID`,
`RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `CLOVER_MANORS_SANDBOX_*` (3),
`MICROSOFT_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `R2_*` (4),
`DATABASE_URL`, `BLOB_*` (4), `SESSION_JWT_SECRET`, `CRON_SECRET`,
`MFA_ENCRYPTION_KEY`, `CALENDAR_TOKEN_ENCRYPTION_KEY`, `PLATFORM_ADMIN_USER_IDS`,
`DATA_ADAPTER`, `DEPLOYMENT_ORGANIZATION_IDS`.

Production-only already: `JOTFORM_API_KEY`, `JOTFORM_WEBHOOK_SHARED_SECRET`,
`SSN_ENCRYPTION_KEY`, the Certificate/Manatee template keys,
`LOGIN_ORGANIZATION_HOSTS`, `MICROSOFT_MAIL_REDIRECT_URI`,
`RESEND_REPLY_TO_ADDRESS`.

Consequence: code on **any unreviewed branch** runs, in a Manors Preview,
against the live Wix site with a working email/SMS sender, and a Production
session token (same `SESSION_JWT_SECRET`) is accepted by a Preview.

## 2. Target design

```
feature branches ──► master (integration; builds the two sandboxes only)
                       │
        tested commit  ├──► release/manors ──► manors-cremation-dashboard (Production)
                       └──► release/gus    ──► gus-solis (new, Production)
```

- **One release branch per funeral home.** A home is released by moving its
  own branch to an already-tested `master` commit
  (`git push origin <sha>:release/manors`). Merging to `master` publishes no
  funeral home.
- **Each Production project builds only its own release branch** (Production
  branch setting + Ignored Build Step). Previews are not built in Production
  projects at all.
- **Previews live only in the mock sandboxes**, which hold no live
  credentials.
- **Gus gets a new project** (`gus-solis`). `gus-solis-sandbox` stays Gus's
  mock staging; the legacy `gus-solis-preview` (other repository) is not
  reused or modified.

`scripts/vercel-ignore-build.mjs` (tested in
`scripts/vercel-ignore-build.test.ts`) implements the Ignored Build Step:
it builds only branches listed in the project's `SOLIS_BUILD_BRANCHES`
(exit 1 = build, 0 = skip) and is inert when the variable is unset. Until
the script is on the branch a project builds, the equivalent inline command
in §3 can be used instead.

## 3. Exact changes requiring approval (in order)

### Step A — stop Previews in the Manors Production project (security, first)

`manors-cremation-dashboard` → Settings → Git → Ignored Build Step:

```
[ "$VERCEL_GIT_COMMIT_REF" = "master" ] && exit 1 || exit 0
```

Effect: only `master` builds (Production unchanged); every other branch is
skipped, so no Manors Preview with live credentials is created again. No
code change needed. Rollback: clear the field.

### Step B — remove live credentials from Manors Preview

After A, remove the **Preview** target (keep Production) from every variable
listed in §1, and add Preview-only `DATA_ADAPTER=mock`. Give Preview its own
`SESSION_JWT_SECRET`, `CRON_SECRET`, `MFA_ENCRYPTION_KEY`,
`CALENDAR_TOKEN_ENCRYPTION_KEY` if Previews are ever re-enabled. Existing
Preview deployments keep their old environment: **delete the existing
Manors Preview deployments** (or confirm they're SSO-protected and let them
age out). Production deployments are not affected. Rollback: re-add the
Preview target.

Optional hardening: rotate the live `WIX_API_KEY`, `RESEND_API_KEY`,
`TWILIO_AUTH_TOKEN`, `MICROSOFT_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`, `R2_*`
if any non-team member ever had Preview access. Rotating `SESSION_JWT_SECRET`
signs everyone out once.

### Step C — Manors release branch

1. `git push origin 88b2b67:release/manors` (the commit Production serves).
2. `manors-cremation-dashboard`: Production Branch → `release/manors`;
   Ignored Build Step → `node scripts/vercel-ignore-build.mjs` once the script
   is on `release/manors` (until then
   `[ "$VERCEL_GIT_COMMIT_REF" = "release/manors" ] && exit 1 || exit 0`);
   env `SOLIS_BUILD_BRANCHES=release/manors` (Production + Preview).
3. From then on, pushes to `master` deploy only the sandboxes. Manors
   releases: `git push origin <tested-sha>:release/manors` (fast-forward
   only).

### Step D — sandboxes build only integration branches

`manors-solis-sandbox`, `gus-solis-sandbox`: Ignored Build Step as above with
`SOLIS_BUILD_BRANCHES=master,preview/*` (or `master,feat/*` if you want
every feature branch previewed — they are mock-only). Production branch
stays `master`.

### Step E — Gus Production project

Create `gus-solis` on the shared repository:

- Production Branch `release/gus`; Ignored Build Step
  `node scripts/vercel-ignore-build.mjs`; `SOLIS_BUILD_BRANCHES=release/gus`.
- Vercel Authentication on Previews (`all_except_custom_domains`).
- Environment (Production only): `DEPLOYMENT_ORGANIZATION_IDS=gus-camacho-jr`,
  `DATA_ADAPTER=wix`, the Wix site credentials Gus is approved to use,
  **its own** `SESSION_JWT_SECRET`, `CRON_SECRET`, `MFA_ENCRYPTION_KEY`,
  `SSN_ENCRYPTION_KEY`, `CALENDAR_TOKEN_ENCRYPTION_KEY`, `APP_BASE_URL` and
  `NEXT_PUBLIC_APP_URL=https://solis.guscamacho.com`,
  `LOGIN_ORGANIZATION_HOSTS` mapping `solis.guscamacho.com` → `gus-camacho-jr`.
  **No** Resend/Twilio/Clover/JotForm/Microsoft values until each Gus
  integration is approved (the code keeps Gus sending off).
- `release/gus` is created only when Gus onboarding is approved (B3).

### Step F — `solis.guscamacho.com`

`guscamacho.com` is not in this Vercel team and `solis.guscamacho.com` does
not resolve today. Add the domain to `gus-solis`, then at Gus's DNS provider
create `CNAME solis → cname.vercel-dns.com` (Vercel shows the exact target
when the domain is added). Update any OAuth redirect URIs (Microsoft/Google)
only when those integrations are enabled for Gus.

## 4. Rollback, per funeral home

- **Fast (no build):** Vercel → the home's project → Deployments → the last
  good Production deployment → *Instant Rollback* (CLI:
  `vercel rollback <deployment-url> --scope <team>`). Affects only that
  project. While rolled back, new Production deployments of that project are
  not auto-assigned until *Undo Rollback* / `vercel promote`.
- **Code:** `git revert` the bad change on `master`, re-test, then move only
  the affected home's release branch forward. Never force-move a release
  branch backwards unless the rollback above is in place.
- Manors' last known-good Production deployment today:
  `dpl_CpxmyCzAPRLC9JYBPdNMsb7Kqpti` (`88b2b67`).

## 5. Proving a Gus release cannot deploy Manors

After Steps C and E:

1. Push a no-op commit to `release/gus`.
2. `vercel api "/v6/deployments?projectId=prj_xraQl2RYSch4e5CBVzf3BGxqYVLR&limit=3"`
   — Manors shows **no new build** (or one marked ignored/canceled), and its
   current Production deployment id is unchanged.
3. `curl -sI https://solis.manorscremation.com/login` still returns the same
   deployment (`x-vercel-id`), and the Gus project shows the new build.
4. Repeat in reverse (push `release/manors`, Gus unchanged).
