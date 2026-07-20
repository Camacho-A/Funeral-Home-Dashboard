# Changelog

All notable changes to Beacon are recorded here. This project follows [Semantic Versioning](https://semver.org/); see [README.md](../README.md#versioning-strategy) for how version numbers are chosen.

## [0.1.0] — 2026-07-20

### Added
- Project initialized: repository created, production folder structure scaffolded (`app/`, `components/`, `hooks/`, `lib/`, `services/`, `types/`, `utils/`, `public/`, `styles/`, `design/`, `docs/`).
- Design source of truth (`design/Beacon.dc.html`, `design/support.js`) brought into the repository as an immutable reference artifact.
- Full documentation set established under `docs/`: product vision, architecture, CMS schema, user roles, business rules, roadmap, decisions, API spec (proposed, unimplemented), and UI component catalogue.
- Architecture decisions recorded for the Wix Managed Headless + Postgres compliance-service split, tenant isolation strategy, and auth/RBAC approach — see [DECISIONS.md](./DECISIONS.md).

### Notes
- No application code, API routes, or Wix CMS collections exist yet. This release is documentation and project scaffolding only.
