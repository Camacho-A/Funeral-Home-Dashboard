# Architecture

## System Overview

Beacon is a single Next.js application (App Router, TypeScript) that serves as a staff operations portal. It talks to two backend systems, split deliberately by data sensitivity:

```
                         ┌─────────────────────────────┐
   Staff browser  ─────▶ │   Next.js app (Vercel)       │
                         │   - Server Components/pages  │
                         │   - Route Handlers (/api/*)  │
                         └──────────────┬───────────────┘
                                        │
                    ┌───────────────────┼────────────────────┐
                    ▼                                        ▼
     ┌───────────────────────────┐          ┌───────────────────────────────┐
     │   Wix Headless             │          │  Compliance service            │
     │   - Wix Data (Cases,       │          │  - Postgres (Neon/Supabase)    │
     │     CaseContacts,          │          │    Document + AuditLog rows    │
     │     CaseTasks,              │          │  - Object storage (Cloudflare │
     │     StaffProfiles)          │          │    R2 / S3) for the actual     │
     │   - Wix Members (identity)  │          │    files                        │
     └───────────────────────────┘          └───────────────────────────────┘
```

Wix Managed Headless is the backend for everything operational: case records, next-of-kin contacts, the office-wide task list, and staff identity/profile. It was chosen because the client wants a Wix-managed backend rather than a fully custom one, and Wix Data is a perfectly reasonable document store for this kind of structured, per-case data.

The one deliberate exception is **compliance documents** — death certificates, cremation permits, signed authorizations and contracts — plus the **audit trail** of who accessed or changed what. Wix Data is not built for retention guarantees, fine-grained access auditing, or the querying compliance work eventually needs, so that data lives in a small, dedicated Postgres + object-storage service instead. See [DECISIONS.md](./DECISIONS.md) for the reasoning.

The browser never talks to Wix or Postgres directly. Every request goes through the Next.js app's own Route Handlers, which hold the Wix API key, the database connection string, and the object-storage credentials — none of which are ever shipped to the client.

## Tenant Isolation

Version 1 has exactly one tenant (Managed Cremations), but every record in every store — every Wix Data item and every Postgres row — carries an `organizationId` field from day one. Every query helper takes `organizationId` as a required argument, sourced only from the authenticated session, never from a client-supplied parameter. This means the code is multi-tenant-correct today, even though the UI and business logic only ever operate against a single hardcoded organization id. Onboarding a second funeral home later is a matter of provisioning a new `organizationId` and the corresponding Wix Data rows / Postgres rows — it does not require a schema migration or a rewrite of query logic. See [CMS_SCHEMA.md](./CMS_SCHEMA.md) for the exact fields.

## Auth & Identity

Staff authenticate through **Wix Members** — Wix issues and owns the member session, so Beacon never builds or maintains a parallel identity system. Wix's own member roles are not used for authorization, though: they're too coarse for Beacon's admin / funeral_director / staff distinction. Instead, a `StaffProfiles` Wix Data collection (keyed 1:1 to a Wix Member) carries the app-specific `role` and `organizationId`, and all of Beacon's role-based access control reads from that collection, not from Wix's own permission model.

On login, the Next.js app validates the Wix Member session server-side, looks up the matching `StaffProfiles` row, and mints its own signed session token (a JWT) into an HttpOnly, Secure cookie containing `{ memberId, organizationId, role, staffProfileId }`. `middleware.ts` verifies that token on every request to a protected route or API endpoint before anything else runs. See [USER_ROLES.md](./USER_ROLES.md) for what each role can do.

## Folder-to-Concern Mapping

- **`app/`** — Next.js App Router routes only: pages and Route Handlers. Pages are kept thin — they compose components and call hooks/services, they do not contain business logic.
- **`components/`** — presentational UI, organized by feature area (`layout/`, `dashboard/`, `case/`, `tasks/`, `reports/`, `modals/`) plus a shared `ui/` folder of primitives (Button, Card, Badge, Checkbox, Modal, form fields). Components should be as close to pure/presentational as practical; anything stateful or business-logic-bearing belongs in `hooks/`.
- **`hooks/`** — React hooks that wrap `services/` calls and expose loading/error/data state to components, plus the view-model hooks (e.g. `useCaseViewModel`) that perform the same kind of derivation `buildCase()` does in the original design script (see [UI_COMPONENTS.md](./UI_COMPONENTS.md)).
- **`services/`** — the only code that talks to Wix Data or Postgres. Each service (`casesService`, `contactsService`, `tasksService`, `staffService`, `documentsService`, `auditService`) exposes typed functions that take `organizationId` explicitly and return domain types from `types/`. `documentsService` and `auditService` are the only two that touch Postgres/object storage; everything else goes through Wix.
- **`lib/`** — low-level client setup: the configured Wix SDK client, the Prisma client, the object-storage (S3/R2) client, session/JWT helpers, and environment validation. `services/` is built on top of `lib/`, not the other way around.
- **`types/`** — shared TypeScript types/interfaces for every domain entity (`Case`, `CaseContact`, `CaseTask`, `StaffProfile`, `Document`, `AuditLogEntry`) plus the derived view-model shapes components actually render (`CaseViewModel`).
- **`utils/`** — pure, stateless helper functions with no I/O: stage/checklist/SLA logic, badge color mapping, timeline construction, print-window helpers. These are extracted directly from the business logic embedded in the original design script — see [BUSINESS_RULES.md](./BUSINESS_RULES.md).
- **`styles/`** — the shared design-token layer (OKLCH color variables, type scale, radius scale) extracted from the design source, plus global resets, so every component pulls from one place rather than repeating inline styles.
- **`design/`** — the original exported design artifacts (`Beacon.dc.html`, `support.js`). These are treated as an immutable specification and are never imported into the running application or edited.

## Workflow Template Architecture

As of Phase 11, an organization's case workflow — stages, checklist items, intake fields — is versioned configuration (`types/workflowTemplate.ts`, resolved by `domain/workflow/`), not hardcoded domain constants or React components. Every `Case` stores which template/version it was created from plus an immutable snapshot of it, so editing a template later never changes an existing case. See [TEMPLATE_VERSIONING.md](./TEMPLATE_VERSIONING.md) for the full model and [ADR-006](./adr/ADR-006-workflow-template-architecture.md) for why. Note: the "Folder-to-Concern Mapping" section above still describes stage/checklist/SLA logic as living in `utils/` — that predates [ADR-004](./adr/ADR-004-domain-layer.md)'s decision to give it its own `domain/` layer instead; this document hasn't been corrected for that yet.

## Wix Integration Foundation

As of Phase 12, `lib/env.ts` and `lib/wixClient.ts` establish the boundary future Wix integration work must respect: a `DATA_ADAPTER` switch defaulting to `mock` (unchanged fixture-backed behavior), and a server-only Wix SDK client reachable only from server-side code (Route Handlers, Server Components/Actions) — never from a Client Component or anything it imports, since `WIX_API_KEY` is a secret. No existing `services/*` module calls Wix yet; that remains Phase 13+ work. See [WIX_INTEGRATION.md](./WIX_INTEGRATION.md) for the full reference and [ADR-007](./adr/ADR-007-wix-integration-foundation.md) for why. Note this section's own line above ("`services/` — the only code that talks to Wix Data...") is not yet accurate in practice — no service does today — and will only become true once Phase 13 actually wires one up.

## Authentication & Organizations

As of Phase 13, every portal route requires a valid session (`middleware.ts`, re-checked in `app/(portal)/layout.tsx`), and the active `organizationId` comes only from `lib/auth/authorize.ts`'s `resolveAuthorizationContext` — a server-side lookup against the authenticated user's own membership rows, never a browser-supplied value taken on trust. `useOrganization()` and every existing service call site are unchanged in shape; only where the value they receive comes from changed. See [AUTHENTICATION.md](./AUTHENTICATION.md) for the full flow and [ADR-008](./adr/ADR-008-authentication-and-organizations.md) for why. Organization membership itself still has no real (Wix-hosted) data source — even real Wix member logins resolve access from the same mock fixtures mock mode uses; see AUTHENTICATION.md's "Known limitations."

As of Phase 15A.1, which login provider is used is controlled by its own `AUTH_ADAPTER` variable, independent of `DATA_ADAPTER` (which controls data access only) — see [ADR-011](./adr/ADR-011-auth-data-adapter-separation.md) and AUTHENTICATION.md's "Development vs. production adapter combinations."

## Wix Data Schema

As of Phase 14, `docs/WIX_DATA_SCHEMA.md` is the authoritative, approved specification for the six Wix Data collections (`organizations`, `organizationMemberships`, `workflowTemplates`, `workflowTemplateVersions`, `cases`, `tasks`) Beacon's first backend integration needs — superseding `docs/CMS_SCHEMA.md`'s `Cases`/`CaseTasks`/`StaffProfiles` sections. See [ADR-009](./adr/ADR-009-wix-data-schema.md) for why this shape was chosen. **None of these collections exist in Wix yet** — the schema is approved but not created; see WIX_DATA_SCHEMA.md's "Known limitations." No `services/*` module reads or writes Wix Data; `DATA_ADAPTER=mock` remains the default and only functioning mode.

## API Layer

Route Handlers under `app/api/*` are the only code with access to backend credentials. The pattern for every mutating handler is: verify session → check role → validate input → call the appropriate `services/*` function (scoped by the session's `organizationId`) → write an audit log entry (for anything touching compliance-relevant data) → return a response. See [API_SPEC.md](./API_SPEC.md) for the proposed route list (not yet implemented).

## Hosting

- **Application**: Vercel (Next.js-native hosting, matches the App Router deployment model).
- **Compliance database**: Neon or Supabase (serverless Postgres, low operational overhead, good Vercel integration).
- **Object storage**: Cloudflare R2 (S3-compatible API, no egress fees) or AWS S3.
- **Operational data & auth**: Wix Managed Headless (Wix Data + Wix Members), hosted by Wix.
