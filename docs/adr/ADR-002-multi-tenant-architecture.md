# ADR-002: Multi-Tenant Architecture

**Status:** Accepted
**Date:** 2026-07-20

## Context

Beacon V1 serves a single funeral home (Managed Cremations), but the product is explicitly intended to become a multi-tenant SaaS platform serving many funeral homes (`docs/PRODUCT_VISION.md`, `docs/ROADMAP.md`). Retrofitting tenant scoping onto an already-built data model, service layer, and cache is expensive and risky: it's easy to miss a query path, and the failure mode — one funeral home's case data becoming visible to another — is severe. `docs/DECISIONS.md` (ADR-002) already established `organizationId` as the tenant-scoping field on every Wix Data collection and Postgres table at the schema level; this decision extends that same discipline through the entire frontend.

## Decision

Every domain type, service function, fixture, and cache key in the frontend is scoped by `organizationId`, using that exact field name — the same one already used in `docs/CMS_SCHEMA.md` and `docs/ARCHITECTURE.md` — with no separate frontend-only "tenant" vocabulary. Concretely:

- Every service function (`casesService`, `contactsService`, `tasksService`, `staffService`, `documentsService`, `caseLogService`) takes a typed `OrganizationContext` (`{ organizationId: string }`) as its first argument.
- `organizationId` is obtained only through an `OrganizationProvider`/`useOrganization()` hook — no component or hook ever hardcodes an organization id string.
- Every TanStack Query cache key includes `organizationId` as its leading segment (e.g. `['cases', organizationId, filters]`).
- Mock fixtures (`services/__mocks__/fixtures.ts`) seed every record with `organizationId` and services **actively filter by it**, rather than assuming isolation, even though only one organization exists today.

## Consequences

- A second funeral home can be onboarded later without a schema migration or a retrofit of query logic — the field and the scoping discipline already exist everywhere.
- Cross-tenant data leakage is structurally harder to introduce by accident: mock services exercise real filtering logic now, so the isolation behavior is tested well before it's load-bearing.
- One consistent name across the Wix/Postgres schema and the entire frontend removes an entire class of mapping bugs and mental overhead that a separate `tenantId` vocabulary would have introduced at the service boundary.
- V1 still hardcodes a single `organizationId` value and has no multi-tenant management UI (organization creation, staff invitation, per-organization settings) — that remains a distinct, later roadmap item (`docs/ROADMAP.md`), not something this decision builds now.
- Slightly more boilerplate per service call today (explicitly threading a context object) for a benefit that only fully materializes once a second organization exists.

## Alternatives Considered

- **Defer tenant scoping until a second funeral home actually signs up**: rejected — retrofitting scoping after real case data, staff workflows, and cached queries are already live in production is far riskier and more expensive than building it in from the start.
- **A separate, frontend-only `tenantId` concept, translated to `organizationId` at the service boundary**: considered and explicitly rejected by the client in favor of one consistent name throughout, to avoid an unnecessary translation layer.
- **Provisioning a fully separate Wix site/database per tenant**: out of scope for this decision — real multi-tenant infrastructure provisioning is a distinct roadmap item, not required while there is only one tenant.
