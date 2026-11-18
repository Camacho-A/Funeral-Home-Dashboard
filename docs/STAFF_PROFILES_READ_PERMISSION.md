# `staffProfiles` read permission — observation (2026-11-18)

Recorded during Gus Phase 5H (read-only check of the live shared Beacon Wix
site, "Beacon Development"). **Nothing was changed.**

## What was found

The live `staffProfiles` collection's permissions are:

| Action | Permission |
|---|---|
| insert | ADMIN |
| update | ADMIN |
| remove | ADMIN |
| read | **SITE_MEMBER_AUTHOR** |

Every other staff, membership and case collection checked (`cases`,
`organizationMemberships`, `funeralDirectorCredentials`) is ADMIN for all four
actions, and `docs/WIX_DATA_SCHEMA.md` describes `staffProfiles` as
"backend/Admin only" — so the live setting does not match the documented
intent.

## Why it matters

SOLIS reads `staffProfiles` only from its server with the site API key, so
the application itself is not affected. `SITE_MEMBER_AUTHOR` means a
logged-in member of the Wix site could read rows they authored through Wix's
own member APIs. SOLIS creates these rows with its API key, so in practice no
site member authors them today — but the setting is looser than the
documented design and than every comparable collection.

## Recommendation (needs approval)

Change `staffProfiles` read permission to ADMIN, matching the documentation
and the other collections, after confirming no Wix site page or member
feature reads it. Until approved, leave it as is.
