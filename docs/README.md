# Beacon Documentation

This folder is the source of truth for Beacon's product, architecture, and business rules. **Every future architectural decision should be documented here before it's implemented** — if it isn't written down, it isn't decided.

## Index

| Document | Purpose |
|---|---|
| [PRODUCT_VISION.md](./PRODUCT_VISION.md) | What Beacon is, who it's for, the problem it solves, and what's explicitly out of scope. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System overview, the Wix Headless / Postgres split, tenant isolation, auth, and folder-to-concern mapping. |
| [CMS_SCHEMA.md](./CMS_SCHEMA.md) | Wix Data collection field lists and the Postgres/Prisma schema for compliance documents. |
| [USER_ROLES.md](./USER_ROLES.md) | The `admin` / `funeral_director` / `staff` roles and what each can do. |
| [BUSINESS_RULES.md](./BUSINESS_RULES.md) | The case lifecycle, per-stage checklists, SLA targets, veteran/VA workflow, and document requirements — extracted from the design source. |
| [ROADMAP.md](./ROADMAP.md) | V1 scope and candidate V2 features, in sequence. |
| [CHANGELOG.md](./CHANGELOG.md) | Notable changes, by version. |
| [DECISIONS.md](./DECISIONS.md) | Architecture Decision Records — the *why* behind ARCHITECTURE.md. |
| [API_SPEC.md](./API_SPEC.md) | Proposed API route list (not yet implemented). |
| [UI_COMPONENTS.md](./UI_COMPONENTS.md) | Full component hierarchy and design tokens extracted from `design/Beacon.dc.html`. |

## How These Documents Relate to `design/`

`design/Beacon.dc.html` and `design/support.js` are the client's exported visual design/prototype — treated as an immutable specification (see [DECISIONS.md](./DECISIONS.md), ADR-004). They are never edited and never imported into the running application. Everything in `UI_COMPONENTS.md` and `BUSINESS_RULES.md` was extracted from those files by direct analysis; if the design files are ever updated by the client, these two documents should be re-derived from the new version rather than hand-patched.

## Documentation Workflow

Before implementing a new feature or making an architectural change:

1. Check whether it's already covered here.
2. If it changes architecture, add an entry to [DECISIONS.md](./DECISIONS.md) first.
3. If it changes scope, update [PRODUCT_VISION.md](./PRODUCT_VISION.md) and/or [ROADMAP.md](./ROADMAP.md).
4. If it changes the data model, update [CMS_SCHEMA.md](./CMS_SCHEMA.md).
5. After merging, add an entry to [CHANGELOG.md](./CHANGELOG.md).

No slash-command or automated documentation-generation workflow is configured yet. If that becomes useful (e.g., a command that checks docs/ for staleness against the codebase), it should be proposed and added deliberately rather than assumed.
