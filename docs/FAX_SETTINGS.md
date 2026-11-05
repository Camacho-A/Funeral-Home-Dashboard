# Fax Settings (multi-tenant fax configuration)

Status (2026-11-05): on branch `feat/fax-settings`, **not pushed, not
deployed**. The two Wix collections below do **not** exist live yet and no
live record or permission was changed. Fax sending stays **off**.

Settings → **Fax Settings** lets each funeral home's administrators manage
its own fax configuration. It builds on the DC application fax bundles
(`docs/MANATEE_FAX_BUNDLES.md`); the bundle workflow (select → preview one
combined PDF → send one fax) is unchanged.

## What an administrator can change

| Section | What |
|---|---|
| Fax Destinations | Add, edit (name, fax number, purpose), make default, archive. Many per organization; exactly one default. Never deleted. |
| Provider & Sending Mailbox | The provider (NuSo IPFax is the only one today). The sending mailbox is **shown**, not chosen: it is the organization's connected Outlook mailbox (Settings → Crematory) — no second sign-in flow, and no token ever reaches the browser. |
| Email Subject & Message Templates | Subject template; an optional plain-text message. |
| Cover Page Options | Only when the provider has a verified cover page option. |
| Fax Configuration History | Every change: what, who, when. |

## What can NOT be changed here (code only, reviewed deploy)

- **Fax sending on/off** — `features.deathCertificateFax.sendingEnabled` in
  `domain/organization/organizationProfiles.ts`. The API refuses any
  `sendingEnabled` field (400) and no UI control exists.
- The attachment size limit, and which providers exist and what they support
  (`domain/faxBundles/faxProviders.ts`).
- Whether an organization faxes at all (`features.deathCertificateFax`
  non-null). Gus has no fax settings (404).

## Manors defaults (unchanged until an administrator saves something)

| Setting | Value |
|---|---|
| Destination | Manatee County Vital Statistics |
| Fax number | 941-554-5490 |
| Provider | NuSo IPFax |
| Email-to-fax address | `9415545490@fax.nuso.io` |
| Email subject | `Manors Cremation - DC Application Bundle {reference}` |
| Email body | empty |
| Cover page | disabled |
| Fax sending | disabled until live testing is approved |

With no rows stored, `resolveFaxConfiguration` returns exactly these values
from the organization profile, so deploying this code changes nothing for
Manors. The first time an administrator edits the built-in destination or
adds another, the built-in destination is stored as a normal destination and
stays the default (it is never silently replaced).

## Design

| Piece | Code |
|---|---|
| Records, validation (fax number, name, purpose) | `domain/faxBundles/faxConfiguration.ts` |
| Templates and placeholders | `domain/faxBundles/faxTemplates.ts` |
| Providers and capabilities | `domain/faxBundles/faxProviders.ts` |
| Storage (Wix / in memory) | `services/faxSettings/faxSettingsStore.ts` |
| The one owner (resolve, change, audit, history) | `services/faxSettings/faxSettingsService.ts` |
| Routes | `app/api/organization/fax-settings/**` (auth: `lib/faxSettings/routeAuth.ts`) |
| UI | `app/(portal)/settings/fax`, `components/settings/FaxSettingsPanel.tsx` |

- **Permissions:** `organization.manage` (Administrator) for viewing and
  changing — the same permission as Settings → Crematory, which owns the
  sending mailbox. Already granted live to every organization's
  Administrator, so **no RBAC change or live grant is needed**. A dedicated
  `fax.settings.manage` key was considered and not added: it would need a
  live grant and gives no one access they should have that they lack today.
  Checked by the route (membership of the session's organization, never the
  request alone) **and again by the service** on every change.
- **One default, structurally:** the default is a single pointer
  (`faxSettings.defaultDestinationId`) changed by one revision-conditioned
  write. A destination's `isDefault` is derived, never stored, so two
  administrators can never leave two defaults. The default cannot be
  archived. If a race leaves the default archived, previews and sends refuse
  with a clear message — nothing is faxed anywhere else.
- **Revisions:** every destination and the settings row carry `revision`;
  each write is conditioned on it (a stale writer gets 409 and changes
  nothing). The settings row has a fixed id per organization (`fxs-` +
  hash), so two first saves cannot both create one.
- **Organization isolation:** every read filters by `organizationId` as
  well as id; another organization's destination id is "not found" (404).
- **Audit:** `services/activityService.ts` → `recordFaxConfigurationEvent`
  (category `administration`), event types `fax_settings.updated`,
  `fax_destination.created`, `fax_destination.updated`,
  `fax_destination.archived`, `fax_destination.default_changed`;
  previous/next hold only the changed fields. The history section reads these
  events — there is no other log.
- **Boundary:** only `faxSettingsService.ts` imports the store and records
  these events; routes delegate (structural test in
  `faxSettingsService.test.ts`).

### Templates

Placeholders: `{reference}` (required in the subject), `{organizationName}`
(the profile's email organization name), `{applicationCount}`,
`{pageCount}`. Anything else in braces is refused; anything that looks like
person or case data (`{decedentName}`, `{caseNumber}`, `{ssn}`, …) is refused
with "fax emails never include decedent or case information". Subject: one
line, no control characters, ≤150. Message: plain text (no HTML), `\n` line
endings, ≤2000.

### Provider capabilities

| Provider | Email message | Cover page |
|---|---|---|
| NuSo IPFax (`fax.nuso.io`) | **unverified** — a controlled test turned a one-page PDF + message + signature into a three-page fax | **unsupported** — no verified provider-side option |

`supported` may be enabled and used; `unverified` may be drafted but is never
sent (the server refuses to enable it, and `resolveFaxConfiguration` ignores
an enabled flag for it); `unsupported` is never offered. SOLIS never
generates a cover page and never adds a signature. Changing a capability is a
code change after a controlled test.

### Prepared bundles keep their snapshot

At preview the bundle stores the destination (`destinationId`,
`destinationName`, `destinationFaxNumber`, `destinationAddress`), the
provider (`providerKey`, `gatewayDomain`), the rendered `subject` and
`emailBody`, and `settingsRevision`. Send Fax emails exactly that snapshot —
nothing from the browser is ever a recipient. Before sending, the current
settings are resolved again: if the destination address or provider differs,
or the subject/message would render differently, **nothing is sent** (409,
"changed since the preview — preview again"). A settings change never alters
or redirects a prepared bundle. A change that does not affect the email (a
destination's display name) leaves it sendable as previewed.

Bundles prepared before Fax Settings read as `destinationId` null,
`providerKey` `nuso`, `emailBody` '' and `settingsRevision` null, and send
exactly as before.

## Lifecycle

| Record | States | Transitions |
|---|---|---|
| Destination | `active`, `archived` | active → edited (revision + 1); active → archived (not the default); archived is final (kept for history) |
| Settings | absent → stored | first save creates it from the built-in values; every change revision + 1 |
| Default | built-in → a stored destination | moved by one conditioned write; built-in is stored first, never dropped |

## Wix migration (NOT done — needs approval)

Create both collections in ONE request each, with every index (indexes cannot
be added later; cap 3 regular + 1 unique). Permissions read/insert/update/
remove = **Admin** (API key only), like `faxBundles`. All fields optional at
the Wix level (the app validates). NATIVE collections.

### `faxDestinations`

| Field | Type |
|---|---|
| `beaconFaxDestinationId` (= `_id`, `fxd-` + 32 hex) | TEXT |
| `organizationId`, `name`, `faxNumber`, `providerKey`, `purpose`, `status` | TEXT |
| `revision`, `recordVersion` | NUMBER |
| `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `archivedAt`, `archivedBy` | TEXT |

Indexes: (`organizationId`, `createdAt`), (`organizationId`, `status`).

### `faxSettings`

| Field | Type |
|---|---|
| `beaconFaxSettingsId` (= `_id`, `fxs-` + 40 hex, one per organization) | TEXT |
| `organizationId`, `providerKey`, `defaultDestinationId`, `subjectTemplate`, `bodyTemplate` | TEXT |
| `bodyEnabled`, `coverPageEnabled` | BOOLEAN |
| `revision`, `recordVersion` | NUMBER |
| `createdAt`, `createdBy`, `updatedAt`, `updatedBy` | TEXT |

Index: (`organizationId`).

### `faxBundles` — four new fields (additive)

`destinationId` TEXT, `providerKey` TEXT, `emailBody` TEXT,
`settingsRevision` NUMBER. Existing rows need no change (missing = the
pre-Fax-Settings values). No new index. Add the fields to the schema before
deploying, and verify live that a preview round-trips them.

### Order

1. Create `faxDestinations` and `faxSettings` (with indexes) and add the four
   `faxBundles` fields; verify schema, permissions and `ACTIVE` indexes.
2. Deploy (sending stays off). With no rows, behaviour is unchanged.
3. Optional: an administrator opens Settings → Fax Settings and saves — or
   nothing at all; the built-in Manors values apply either way. No seeding
   script is required.

Safety net if the code is deployed first: reads of a collection that does
not exist (Wix HTTP 404 `WDE0025`, confirmed read-only on the live site
2026-11-05) are treated as "nothing stored", so previews keep using the
built-in values; saving in Fax Settings fails until the collections exist.
Whether Wix stores the four new `faxBundles` fields without a schema change
is not verified — add them first.

Rollback: redeploy the previous build; the collections can stay (unused).
A bundle prepared under the new build carries extra fields the old build
ignores.

**No live permission change is needed** (`organization.manage` already
exists for Administrators).

## Reserved, not built

- Choosing a destination per bundle (today: the default).
- Per-purpose defaults (e.g. one destination for amendments).
- Other providers (an API provider would need credentials: they would be
  stored encrypted on the server — like the Outlook mailbox tokens — never in
  these collections or the browser).
- Provider-side cover pages, once a provider is verified for them.
- A dedicated `fax.settings.manage` permission if non-administrators ever
  need it.
