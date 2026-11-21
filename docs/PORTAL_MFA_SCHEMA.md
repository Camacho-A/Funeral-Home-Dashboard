# Portal-scoped MFA: Wix schema (Phase 5P preflight, 2026-11-20)

Two new, empty Wix CMS collections in the Beacon site, approved
2026-11-20. Creating them is additive: no existing collection, field or
record is changed, and the original MFA fields on `identities` (Manors
Production's enrollment) are never written by the portal code (tested).
No records are inserted at creation.

## Permissions (both collections)

| Operation | Value | Meaning |
|---|---|---|
| read | `ADMIN` | Site owner and collaborators only. Never public visitors (`ANYONE`), signed-in site members (`SITE_MEMBER`) or item authors (`SITE_MEMBER_AUTHOR`). |
| insert | `ADMIN` | Same |
| update | `ADMIN` | Same |
| remove | `ADMIN` | Same |

SOLIS reaches them only server-side, through the site API key
(`lib/wixDataApi.ts`). No page code, frontend SDK or member area reads
them.

## `portalMfaEnrollments`

One row per (portal scope, staff identity).

| Field | Type | Contents |
|---|---|---|
| `scopeId` | TEXT | `portal-` plus 20 hex characters: a one-way SHA-256 digest of the portal's own `MFA_ENCRYPTION_KEY` (never the key) |
| `identityId` | TEXT | SOLIS identity id |
| `secretReference` | TEXT | TOTP secret, AES-256-GCM ciphertext (base64, random IV and auth tag) under the portal's own `MFA_ENCRYPTION_KEY`. Never plaintext. |
| `verifiedAt` | TEXT | ISO time it was enabled; null while pending |
| `recoveryCodeHashes` | ARRAY_STRING | HMAC-SHA-256 of each recovery code, keyed with a value derived from the portal key. Never the codes. |
| `createdAt`, `updatedAt` | TEXT | ISO times |

- **Item `_id`:** `{scopeId}-{identityId}`, deterministic and at most 120
  characters (Wix's limit is 128).
- **Uniqueness:** Wix refuses a second item with the same `_id`, so there
  is at most one enrollment per portal and person, even under concurrency.

## `portalMfaSetupGrants`

Grants and the claim that uses each grant share one collection, told apart
by `kind`.

| Field | Type | Grant row | Redemption row |
|---|---|---|---|
| `kind` | TEXT | `grant` | `redemption` |
| `id` | TEXT | grant UUID (same as `_id`) | `{grantId}-redeemed` |
| `scopeId` | TEXT | portal scope | same |
| `identityId` | TEXT | staff member it is for | same |
| `codeHash` | TEXT | HMAC-SHA-256 of the normalized one-time code, keyed from the portal key. Never the code. | none |
| `organizationId` | TEXT | organization the administrator acted in | none |
| `grantedBy` | TEXT | administrator identity id (never the same as `identityId`) | none |
| `grantedAt`, `expiresAt` | TEXT | ISO times; `expiresAt = grantedAt + 30 min` | none |
| `usedAt`, `revokedAt` | TEXT | null until used / revoked | none |
| `grantId`, `redeemedAt` | TEXT | none | the grant, and when it was used |

- **Item `_id`:** grant UUID (36 characters) or `{grantId}-redeemed` (45
  characters).

## Indexes

None requested. Both collections stay tiny (one row per staff member per
portal, plus short-lived grants). Every query filters on `scopeId` +
`identityId` (+ `kind`). Uniqueness comes from deterministic `_id`s, which
Wix enforces. An index can be added later without changing data.

## Guarantees (verified in code and tests, Phase 5P)

| Requirement | How | Test |
|---|---|---|
| No public or member access | All four permissions `ADMIN`; server-only API-key access | Verified on the live collection after creation (below) |
| Recovery and setup codes only as hashes | Keyed HMAC (`portalCodeHash`); raw codes shown once, never stored | `portalScopedMfa.test.ts` › keyed hashes, setup codes |
| Secrets encrypted with the portal's own key | `encryptTotpSecret` with the deployment's `MFA_ENCRYPTION_KEY` (fresh for `gus-solis`, never Manors') | same, plus `unifiedPortalSessionsAndNumbering.test.ts` |
| Scoped to the right portal and person | Every read and write filters `scopeId` + `identityId`; enrollment `_id` contains both | `portalScopedMfa.test.ts` |
| Expiry | Redeem refuses after `expiresAt` (30 min) | › expires after 30 minutes |
| Replay prevention | Single use: the redemption row's fixed `_id` can be inserted once (Wix 409 on a second) | › simultaneous redemptions, `portalMfaStore.wix.test.ts` |
| Revocation | Issuing a new code sets `revokedAt` on earlier unused ones | › a new code revokes the earlier one |
| Concurrency | Redemption: exactly one wins. Enrollment: one row per `_id`. Issuance: one request per explicit click (UI). Two simultaneous issues by different administrators could leave two valid codes for up to 30 minutes, both for the same person. | tests above, plus `PortalMfaSetupCodeDialog.test.tsx` |
| Manors MFA untouched | Portal mode never reads or writes `identities` MFA fields | › "a Manors enrollment is never touched" |

## Creation request (Wix Data Collections API)

`POST https://www.wixapis.com/wix-data/v2/collections`, one request per
collection.

```json
{ "collection": { "id": "portalMfaEnrollments", "displayName": "Portal MFA Enrollments",
  "permissions": { "read": "ADMIN", "insert": "ADMIN", "update": "ADMIN", "remove": "ADMIN" },
  "fields": [
    { "key": "scopeId", "type": "TEXT" }, { "key": "identityId", "type": "TEXT" },
    { "key": "secretReference", "type": "TEXT" }, { "key": "verifiedAt", "type": "TEXT" },
    { "key": "recoveryCodeHashes", "type": "ARRAY_STRING" },
    { "key": "createdAt", "type": "TEXT" }, { "key": "updatedAt", "type": "TEXT" } ] } }
```

```json
{ "collection": { "id": "portalMfaSetupGrants", "displayName": "Portal MFA Setup Grants",
  "permissions": { "read": "ADMIN", "insert": "ADMIN", "update": "ADMIN", "remove": "ADMIN" },
  "fields": [
    { "key": "kind", "type": "TEXT" }, { "key": "id", "type": "TEXT" },
    { "key": "scopeId", "type": "TEXT" }, { "key": "identityId", "type": "TEXT" },
    { "key": "codeHash", "type": "TEXT" }, { "key": "organizationId", "type": "TEXT" },
    { "key": "grantedBy", "type": "TEXT" }, { "key": "grantedAt", "type": "TEXT" },
    { "key": "expiresAt", "type": "TEXT" }, { "key": "usedAt", "type": "TEXT" },
    { "key": "revokedAt", "type": "TEXT" }, { "key": "grantId", "type": "TEXT" },
    { "key": "redeemedAt", "type": "TEXT" } ] } }
```

## Before and after creation (read-only checks)

- **Before:** the names are not already taken (list collections).
- **After:** read each collection back, and confirm:
  - all four permissions are `ADMIN`;
  - the fields match the tables above;
  - the item count is 0;
  - existing collections, including `identities`, are unchanged.
