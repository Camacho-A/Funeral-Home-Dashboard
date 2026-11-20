# Gus — open client decisions (2026-11)

Nothing below has been assumed in code. Where SOLIS needed a safe default
while a decision is open, it is the more restrictive option and is listed.

## Services and preparation

1. **Mass** — its own service or part of another? Body present, cremated remains, or both? (Draft only; not offered.)
2. **Traditional funeral / burial / entombment workflows** — steps not supplied (drafts only).
3. **Viewing** — what happens when the family brings no clothing? Rental or purchased casket, and who supplies it?
4. **Final Goodbye** — is 60 minutes the confirmed maximum? (Today: flagged, not blocked.)
5. Prayer cards, register book, crucifix for a Final Goodbye — offered or not? (Today: not offered.)
6. Default deadline targets for Gus's vendors and parishes — confirm.

## Release for cremation

7. **License re-verification every 365 days** — confirm (configurable).
8. **Who administers funeral director credentials** — today any administrator (`organization.manage`), never for themselves.
9. **While on hold, may service preparation be edited again?** Today: read-only after the first release (safer default).
10. **Withdrawing a pending release request** before sign-off — allowed, by whom? Not built.
11. **Release corrections** — approve the proposal in `docs/SERVICE_PREPARATION.md` and who may use it (and whether a second person confirms).
12. **Recording sends while the gate is on** — when enabled, SOLIS refuses to record a send "made outside SOLIS" or to check the "sent to crematory" steps for an unreleased or held case (safer default). Confirm, or choose "allow but flag".

## Roles (see `docs/GUS_ROLE_PERMISSIONS.md`)

13. Configuration permissions held by Administrator + Manager but not Funeral Director (`workflow.edit/publish`, document templates, notification/calendar settings) — align, or keep?
14. `ap.manage` / `ap.pay` (Manager, not Funeral Director) and `caseNumber.manage` (Funeral Director, not Manager) — align, or keep?
15. Checking "sent to crematory" steps by hand, and correcting an earlier-send record — keep Administrator-only, or extend to Managers and Funeral Directors?

## Inputs Gus must supply

16. Service prices (all six catalog services are "price not set").
17. Gus JotForm forms, field lists and API key (`docs/GUS_JOTFORM_REQUIREMENTS.md`).
18. Cremation authorization document source.
19. Crematory recipients and the Outlook mailbox for Send to Crematory.
20. Custom domain for Gus SOLIS.
21. Print Label template (DYMO) and fax destinations for non-cremation services (parked).

## Approvals (live systems)

22. `gus-solis` environment variables; Gus-only Blob store (possible cost).
23. Live Wix credentials on `gus-solis`.
24. Live credential storage, ME approval saving, service-preparation saving.
25. `RELEASE_FOR_CREMATION_AVAILABLE`, then `requireReleaseAfterService: true`.
26. Crematory sending (`sendingEnabled`), email/SMS.
27. First controlled Production deployment (`docs/GUS_DEPLOYMENT_CHECKLIST.md`).
