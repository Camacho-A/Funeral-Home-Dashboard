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

## Decided 2026-11-20 (built, tested; live switches still off)

7. License re-verification every 365 days — **approved**.
8. Credential administration — **Administrators, Managers and Funeral Directors**, never their own; verification independent of the holder.
9. Editing preparation while on hold — **allowed**, reason required, audited, reauthorization required.
10. Withdrawing a pending request — **allowed** for the three leadership roles.
11. Release corrections — **appended**, never overwriting; any of the three roles; no second-person confirmation (not requested).
12. Recording a send made outside SOLIS — **only with a valid release not on hold** (once the gate is on), marked as an external send.
13. Workflow and template management — **granted** to Funeral Directors.
14. Vendor payments (`ap.manage`, `ap.pay`) — **kept restricted** pending separate approval. Case-number management — **granted** to Managers, audited.
15. Checking the "sent to crematory" steps by hand — **all three roles**, release gate enforced on the server. (Correcting an earlier-send record stays Administrator-only.)

## Still open

- Vendor payment authorization (`ap.manage`, `ap.pay`) for Funeral Directors — awaiting a separate decision.
- Should a release correction need a second person to confirm it? (Not requested; easy to add.)

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
