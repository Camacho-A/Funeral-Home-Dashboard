# Beacon

Operations platform for funeral homes and cremation providers — case tracking, staff task management, and operational reporting, built to enforce a provider's own regulated process at every stage.

## Project Overview

Beacon replaces the spreadsheets and paper case files most small-to-mid-size funeral homes use to track a case from first call through final disposition. It gives staff a single system of record that makes the correct next step obvious, surfaces delays before they become a family's or a regulator's problem, and keeps a permanent, auditable record of what happened and when.

Version 1 is being built for a single client, Managed Cremations (operating as Manor Cremation), but the platform is architected from day one to become a multi-tenant SaaS product serving many independent funeral homes.

## Vision

See [docs/PRODUCT_VISION.md](./docs/PRODUCT_VISION.md) for the full product vision, target users, the problem being solved, and what is explicitly out of scope for Version 1 (public memorial pages, service scheduling, merchandise & payments).

## Technology Stack

- **Next.js** (App Router) + **TypeScript** + **React** — the staff operations portal.
- **Wix Managed Headless** — Wix Data (operational records) and Wix Members (staff authentication).
- **Postgres** (Neon or Supabase) + **S3-compatible object storage** (Cloudflare R2 or AWS S3) — a small, dedicated service for compliance documents (death certificates, permits, signed contracts) and the audit trail, kept separate from Wix because that data isn't compliance-grade in Wix Data. See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) and [docs/DECISIONS.md](./docs/DECISIONS.md) for the reasoning.
- **Vercel** — application hosting.

## Project Structure

```
Beacon/
├── design/       # immutable exported design artifacts (Beacon.dc.html, support.js) — reference only, never edited
├── docs/         # source of truth for product, architecture, schema, and business rules — read this first
├── app/          # Next.js App Router routes (pages + API route handlers)
├── components/   # UI components — ui/, layout/, dashboard/, case/, tasks/, reports/, modals/
├── hooks/        # React hooks wrapping services/ and computing view-model state
├── services/     # the only code that talks to Wix Data or Postgres — one module per domain entity
├── lib/          # low-level client setup: Wix SDK client, Prisma client, object-storage client, session/JWT helpers
├── types/        # shared TypeScript domain types and view-model shapes
├── utils/        # pure, stateless helpers (stage/checklist/SLA logic, timeline construction)
├── styles/       # shared design tokens (colors, type scale, radius scale) and global resets
└── public/       # static assets
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the folder-to-concern mapping in full, and [docs/UI_COMPONENTS.md](./docs/UI_COMPONENTS.md) for the component hierarchy this structure is built to hold.

## Development Workflow

1. Check `docs/` before starting any non-trivial change — if it touches architecture, data model, or scope, the relevant doc should be updated (or an ADR added to `docs/DECISIONS.md`) as part of the same change, not after.
2. Work in small, reviewable increments. Each phase of the build (see `docs/ROADMAP.md`) is expected to be independently runnable and verifiable before the next begins.
3. New Wix Data fields or Postgres schema changes are documented in `docs/CMS_SCHEMA.md` before they're implemented.
4. New API routes are added to `docs/API_SPEC.md` before implementation.

## Coding Standards

- TypeScript strict mode; no `any` without a comment explaining why it's unavoidable.
- No inline styles in application code — all colors, spacing, and radii come from the shared design tokens in `styles/`, ported from the OKLCH palette and type scale documented in `docs/UI_COMPONENTS.md`, so the original design's visual output is reproduced exactly rather than approximated.
- Components are kept as close to presentational as practical; business logic (stage/checklist/SLA rules, from `docs/BUSINESS_RULES.md`) lives in `utils/` and `hooks/`, not scattered across component bodies.
- Every Wix Data query and every Postgres query is scoped by `organizationId`, sourced only from the authenticated session — never from a client-supplied parameter. This is non-negotiable; see `docs/DECISIONS.md` ADR-002.
- `services/` functions are the only code permitted to import the Wix SDK or the Prisma client directly.

## Documentation Standards

`docs/` is the source of truth for Beacon. See [docs/README.md](./docs/README.md) for the full index and the workflow for keeping it current. In short: architecture changes get an ADR before they get code; scope changes update `PRODUCT_VISION.md`/`ROADMAP.md`; schema changes update `CMS_SCHEMA.md`; every merge gets a `CHANGELOG.md` entry.

## How to Run

Application code has not been written yet — this repository currently contains project scaffolding and documentation only (see `docs/CHANGELOG.md`, `[0.1.0]`). Once the Next.js application exists, this section will document local environment setup (required environment variables per `docs/ARCHITECTURE.md`), `npm install`, and `npm run dev`.

## Future Roadmap

See [docs/ROADMAP.md](./docs/ROADMAP.md) for Version 1 scope and candidate Version 2 features (real multi-tenant onboarding, service scheduling, public memorial pages, merchandise & payments, mobile, e-signatures), in the order they're likely to matter.

## Versioning Strategy

Beacon follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. Pre-1.0 releases (`0.x.y`) indicate the product is still stabilizing its core case-management data model and workflows; `1.0.0` marks the first release considered stable enough for another funeral home to be onboarded onto. Every notable change is recorded in [docs/CHANGELOG.md](./docs/CHANGELOG.md).

## Git Workflow

Trunk-based development: short-lived feature branches off `main` (or the primary branch), merged via reviewed pull requests. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, etc.) so `CHANGELOG.md` entries can be traced back to the commits that produced them. Force-pushes to the primary branch and history rewrites are avoided.

## Deployment Strategy

- **Application**: deployed to Vercel from the primary branch, with preview deployments per pull request.
- **Compliance database**: Neon or Supabase (Postgres), migrated via Prisma migrations.
- **Object storage**: Cloudflare R2 (or AWS S3), private bucket, access mediated entirely through short-lived presigned URLs minted by the application after role/organization checks — never public.
- **Operational data & auth**: Wix Managed Headless, managed through the Wix platform directly (no separate deployment step on Beacon's side).

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full system diagram.
