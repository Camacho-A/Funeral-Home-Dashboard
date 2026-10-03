# SOLIS redesign: every mockup and spec

## Add this to GitHub
1. Unzip, and put this folder in the repo at `design/solis-redesign/`.
2. Commit and push. To have Claude Code do it, paste:
   > Add the folder design/solis-redesign/ to the repo exactly as provided. Change no other files. Commit it with the message "Add SOLIS redesign mockups and specs", then push to a new branch called design/solis-redesign.
3. To view the mockups, run `npx serve design/solis-redesign` and open any `.dc.html` file. They don't open directly from disk.

## Mockups
- `SOLIS Phase 1.dc.html`: shell and Dashboard
- `SOLIS Cases.dc.html`: All Cases and stage queues
- `SOLIS Case Detail.dc.html`: Case Detail header, Overview and Documents (first pass)
- `SOLIS Final Workspace.dc.html`: shared system, Reports and Accounting
- `SOLIS Final Utilities.dc.html`: topbar, user menu, notifications, New Case, Audit and Templates
- `SOLIS Final Case Tabs.dc.html`: Workflow, Billing, Activity and Schedule tabs
- `SOLIS Tasks Calendar Settings.dc.html`: Documents tab (latest, D1/D2), Tasks, Calendar and Settings

## Specs for Claude Code (`specs/`)
- `SOLIS-FINAL-PHASE-IMPLEMENTATION.md`
- `SOLIS-TASKS-CALENDAR-SETTINGS-IMPLEMENTATION.md`, together with `ADDENDUM-CASE-DOCUMENTS.md`
- `SOLIS-Visual-Audit.md`

## Shared stylesheets (`styles/`)
`solis-system.css`, `solis-workspace.css` and `solis-documents.css`. Copy them into the app's `styles/` folder and import them in that order, after `solis-redesign.css`.
