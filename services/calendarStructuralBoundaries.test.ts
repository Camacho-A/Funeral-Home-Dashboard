import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, sep } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). The structural tests promised throughout this phase's
 * plan (§26), gathered in one file mirroring
 * `services/financialStructuralBoundaries.test.ts`'s exact pattern:
 * "only the designated service writes to each new collection," "only
 * the designated file(s) import a calendar provider adapter," "only
 * activityService.ts's own record* builders construct a new event
 * type," and the ADR-034 hard layering invariant extension.
 *
 * Two boundaries named in the plan are deliberately NOT re-asserted
 * here: `appointmentReminderService.ts#listDueReminders` and
 * `calendarSyncService.ts#listSweepCandidates` (the two org-agnostic
 * sweep queries) are both private, non-exported functions — no other
 * file could call them even if it tried, so TypeScript's own module
 * privacy already enforces the invariant a structural test would
 * otherwise exist to catch. A textual "only file X calls query Y"
 * test is only meaningful when Y is exported across a file boundary
 * (as `notificationService.ts#listAllQueuedForDigestDeliveries` is,
 * per that file's own structural test).
 */
const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

function walk(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, results);
    } else if (['.ts', '.tsx'].includes(extname(fullPath)) && !fullPath.endsWith('.test.ts') && !fullPath.endsWith('.test.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

const root = join(__dirname, '..');
const allFiles = walk(root);

describe('Calendar collection writers (structural)', () => {
  const writers: Record<string, string> = {
    appointmentReminders: join(__dirname, 'appointmentReminderService.ts'),
    schedulingReminderPolicies: join(__dirname, 'appointmentReminderService.ts'),
    calendarConnections: join(__dirname, 'calendarConnectionService.ts'),
    calendarEventLinks: join(__dirname, 'calendarSyncService.ts'),
    calendarFeedTokens: join(__dirname, 'calendarFeedTokenService.ts'),
  };

  for (const [collection, writerPath] of Object.entries(writers)) {
    it(`only ${writerPath.split(sep).pop()} writes to "${collection}" directly`, () => {
      const writePattern = new RegExp(`(?:insertWixDataItem|updateWixDataItem|deleteWixDataItem)(?:<[^>]*>)?\\(\\s*['"]${collection}['"]`);
      const offenders = allFiles.filter((filePath) => filePath !== writerPath && writePattern.test(readFileSync(filePath, 'utf8')));
      expect(offenders, `unexpected writer(s) of "${collection}": ${offenders.join(', ')}`).toEqual([]);
    });
  }
});

describe('Calendar provider containment (structural, invariants #9/#11 of the plan)', () => {
  const allowedImporters = new Set([join(__dirname, 'calendarConnectionService.ts'), join(__dirname, 'calendarSyncService.ts')]);
  const providerFiles = ['googleCalendarProvider', 'microsoftCalendarProvider'];

  for (const providerFile of providerFiles) {
    it(`only calendarConnectionService.ts/calendarSyncService.ts import ${providerFile}.ts`, () => {
      const importPattern = new RegExp(`from ['"][^'"]*calendar\\/${providerFile}['"]`);
      const offenders = allFiles.filter((filePath) => !allowedImporters.has(filePath) && filePath !== join(__dirname, 'calendar', `${providerFile}.ts`) && importPattern.test(readFileSync(filePath, 'utf8')));
      expect(offenders, `unexpected importer(s) of ${providerFile}.ts: ${offenders.join(', ')}`).toEqual([]);
    });
  }

  it('no route under the new calendar API surface imports a provider file directly', () => {
    const calendarRouteFiles = allFiles.filter(
      (filePath) =>
        filePath.includes(`${sep}app${sep}api${sep}calendar-connections${sep}`) ||
        filePath.includes(`${sep}app${sep}api${sep}calendar-sync${sep}`) ||
        filePath.includes(`${sep}app${sep}api${sep}calendar-feed${sep}`) ||
        filePath.includes(`${sep}app${sep}api${sep}calendar-feed-tokens${sep}`) ||
        filePath.includes(`${sep}app${sep}api${sep}cron${sep}calendar-sync${sep}`) ||
        filePath.includes(`${sep}app${sep}api${sep}cron${sep}appointment-reminders${sep}`) ||
        filePath.includes(`${sep}app${sep}api${sep}scheduling${sep}reminder-policy${sep}`) ||
        filePath.includes(`${sep}app${sep}api${sep}appointments${sep}`),
    );
    expect(calendarRouteFiles.length).toBeGreaterThan(0); // sanity check on the walk itself

    const forbiddenPattern = /from ['"][^'"]*calendar\/(googleCalendarProvider|microsoftCalendarProvider)['"]/;
    const offenders = calendarRouteFiles.filter((filePath) => forbiddenPattern.test(readFileSync(filePath, 'utf8')));
    expect(offenders, `route(s) importing a provider file directly: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('Calendar activity-event emitter boundary (structural)', () => {
  const activityServicePath = join(__dirname, 'activityService.ts');

  const eventEmitters: Record<string, string> = {
    CALENDAR_CONNECTED: join(__dirname, 'calendarConnectionService.ts'),
    CALENDAR_DISCONNECTED: join(__dirname, 'calendarConnectionService.ts'),
    CALENDAR_SYNC_FAILED: join(__dirname, 'calendarSyncService.ts'),
    APPOINTMENT_REMINDER_SENT: join(__dirname, 'appointmentReminderService.ts'),
    APPOINTMENT_REMINDER_FAILED: join(__dirname, 'appointmentReminderService.ts'),
  };

  for (const [key, emitterPath] of Object.entries(eventEmitters)) {
    it(`only ${emitterPath.split(sep).pop()} (and activityService.ts itself) references ACTIVITY_EVENT_TYPES.${key}`, () => {
      const referencePattern = new RegExp(`ACTIVITY_EVENT_TYPES\\.${key}\\b`);
      const offenders = allFiles.filter((filePath) => filePath !== activityServicePath && filePath !== emitterPath && referencePattern.test(readFileSync(filePath, 'utf8')));
      expect(offenders, `unexpected reference(s) to ACTIVITY_EVENT_TYPES.${key}: ${offenders.join(', ')}`).toEqual([]);
    });
  }
});

describe('Calendar UI/route no-direct-Wix boundary (structural)', () => {
  const calendarSurfaceFiles = allFiles.filter(
    (filePath) =>
      filePath.includes(`${sep}app${sep}api${sep}calendar-connections${sep}`) ||
      filePath.includes(`${sep}app${sep}api${sep}calendar-sync${sep}`) ||
      filePath.includes(`${sep}app${sep}api${sep}calendar-feed${sep}`) ||
      filePath.includes(`${sep}app${sep}api${sep}calendar-feed-tokens${sep}`) ||
      filePath.includes(`${sep}components${sep}settings${sep}CalendarIntegrationsPanel`) ||
      filePath.endsWith(`${sep}hooks${sep}useCalendarIntegrations.ts`) ||
      filePath.endsWith(`${sep}lib${sep}calendarIntegrationsClient.ts`),
  );

  it('found at least one calendar surface file to check (sanity check on the walk itself)', () => {
    expect(calendarSurfaceFiles.length).toBeGreaterThan(0);
  });

  it('no calendar route/UI/client file imports lib/wixDataApi or calls its functions directly', () => {
    const forbiddenPattern = /from ['"][^'"]*wixDataApi['"]|(?:insertWixDataItem|updateWixDataItem|queryWixDataItems|deleteWixDataItem)\s*\(/;
    const offenders = calendarSurfaceFiles.filter((filePath) => forbiddenPattern.test(readFileSync(filePath, 'utf8')));
    expect(offenders, `file(s) touching Wix Data directly: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('Phase 34: hard layering invariant — no forbidden *IdentityId field on new calendar/reminder types', () => {
  const newTypeFiles = ['appointmentReminder.ts', 'schedulingReminderPolicy.ts', 'calendarConnection.ts', 'calendarEventLink.ts', 'calendarFeedToken.ts'];

  for (const fileName of newTypeFiles) {
    it(`${fileName} declares no forbidden *IdentityId field on an operational-assignment entity`, () => {
      const source = readFileSync(join(root, 'types', fileName), 'utf8');
      const fieldPattern = /^\s*(\w+)\??:\s*/gm;
      const offenders: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = fieldPattern.exec(source)) !== null) {
        const fieldName = match[1];
        // recipientIdentityId on AppointmentReminder is a deliberate,
        // documented carve-out (a notification-delivery-layer
        // resolution, not an operational assignment) — see
        // types/identityLayeringInvariant.test.ts's own comment on why
        // appointmentReminder.ts is excluded from that file's scan.
        if (fieldName.endsWith('IdentityId') && fieldName !== 'recipientIdentityId') offenders.push(fieldName);
      }
      expect(offenders).toEqual([]);
    });
  }

  it("calendarConnection.ts's staffProfileId is StaffProfile-space, not an *IdentityId shortcut", () => {
    const source = readFileSync(join(root, 'types', 'calendarConnection.ts'), 'utf8');
    expect(source).toMatch(/staffProfileId:\s*string/);
    // A field declaration specifically (never merely the word
    // "identityId" anywhere — the file's own header comment legitimately
    // discusses why identityId is NOT used here).
    expect(source).not.toMatch(/^\s*identityId\??:\s*/m);
  });
});
