/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). A provider-neutral interface — mirrors
 * `services/notifications/emailChannel.ts`'s/`smsChannel.ts`'s exact
 * shape (a plain interface, real adapters implementing it directly via
 * `fetch`, no SDK — matching every existing external-API integration
 * in this codebase: Clover, Resend, Twilio). Unlike email/SMS's single
 * `getXProvider()` selection (one environment-wide choice), calendar
 * provider selection is per-`CalendarConnection` row
 * (`connection.provider`) — `calendarConnectionService.ts`/
 * `calendarSyncService.ts` pick the adapter directly by provider name,
 * never a global singleton.
 *
 * `SchedulingService` and every UI component never depend on either
 * adapter directly (invariants #9/#11) — only
 * `calendarConnectionService.ts`/`calendarSyncService.ts` import
 * `googleCalendarProvider.ts`/`microsoftCalendarProvider.ts`, enforced
 * by a structural test mirroring `notificationService.test.ts`'s own
 * channel-containment pattern.
 *
 * See docs/adr/ADR-038-scheduling-integrations-calendar-sync-and-reminders.md.
 */

export type CalendarEventDraft = {
  title: string;
  description: string;
  /** ISO instants — both providers accept RFC3339/ISO 8601 directly. */
  startAt: string;
  endAt: string;
  location: string | null;
  /** IANA timezone name — both providers expect this alongside the
      instant, not derived from it. */
  timezone: string;
};

export type CalendarEventRef = {
  externalCalendarId: string;
  externalEventId: string;
};

export type CalendarListEntry = {
  id: string;
  name: string;
};

export type CalendarTokenExchangeResult = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  /** The connected account's own email, resolved from the token
      response/userinfo — display-only, shown in Settings as "connected
      as jane@gmail.com", never a secret. */
  accountEmail: string;
};

export type CalendarTokenRefreshResult = {
  accessToken: string;
  /** Both providers may issue a NEW refresh token on refresh (Microsoft
      always rotates it on every use) — the caller must persist
      whichever value comes back here, never assume the original
      refresh token is still valid going forward. */
  refreshToken: string;
  expiresAt: string;
};

export class CalendarProviderError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CalendarProviderError';
    this.status = status;
  }
}

export interface CalendarProvider {
  /** Builds the provider's own authorize URL — `state` and
      `codeChallenge` are always caller-supplied (PKCE + CSRF state are
      `calendarConnectionService.ts`'s responsibility, never generated
      inside a provider adapter). */
  buildAuthorizeUrl(state: string, codeChallenge: string): string;
  exchangeCodeForTokens(code: string, codeVerifier: string): Promise<CalendarTokenExchangeResult>;
  refreshAccessToken(refreshToken: string): Promise<CalendarTokenRefreshResult>;
  listCalendars(accessToken: string): Promise<CalendarListEntry[]>;
  createEvent(accessToken: string, calendarId: string, draft: CalendarEventDraft): Promise<CalendarEventRef>;
  updateEvent(accessToken: string, ref: CalendarEventRef, draft: CalendarEventDraft): Promise<void>;
  deleteEvent(accessToken: string, ref: CalendarEventRef): Promise<void>;
}
