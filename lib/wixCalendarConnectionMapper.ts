import type { CalendarConnection, CalendarConnectionStatus, CalendarProviderName } from '../types/calendarConnection';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Standard mapper pair for the `calendarConnections`
 * collection. `accessTokenCiphertext`/`refreshTokenCiphertext` are
 * opaque AES-256-GCM ciphertext strings by the time they reach this
 * mapper — encryption/decryption happens exclusively in
 * `lib/identity/calendarTokenEncryption.ts`, never here.
 */
export type WixCalendarConnectionItem = {
  beaconCalendarConnectionId?: unknown;
  organizationId?: unknown;
  staffProfileId?: unknown;
  provider?: unknown;
  externalAccountEmail?: unknown;
  externalCalendarId?: unknown;
  status?: unknown;
  scopesGranted?: unknown;
  accessTokenCiphertext?: unknown;
  refreshTokenCiphertext?: unknown;
  tokenExpiresAt?: unknown;
  connectedAt?: unknown;
  disconnectedAt?: unknown;
  lastSyncAt?: unknown;
  lastErrorAt?: unknown;
  lastErrorCode?: unknown;
  lastErrorMessage?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_PROVIDERS: readonly string[] = ['google', 'microsoft'];
const VALID_STATUSES: readonly string[] = ['connected', 'disconnected', 'reauth_required', 'error'];

function isProvider(value: unknown): value is CalendarProviderName {
  return typeof value === 'string' && VALID_PROVIDERS.includes(value);
}

function isStatus(value: unknown): value is CalendarConnectionStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixCalendarConnectionItem(item: WixCalendarConnectionItem | undefined): CalendarConnection | null {
  if (
    !item ||
    typeof item.beaconCalendarConnectionId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.staffProfileId !== 'string' ||
    !isProvider(item.provider) ||
    typeof item.externalAccountEmail !== 'string' ||
    typeof item.externalCalendarId !== 'string' ||
    !isStatus(item.status) ||
    typeof item.scopesGranted !== 'string' ||
    typeof item.accessTokenCiphertext !== 'string' ||
    typeof item.refreshTokenCiphertext !== 'string' ||
    typeof item.tokenExpiresAt !== 'string' ||
    typeof item.connectedAt !== 'string' ||
    !isStringOrNull(item.disconnectedAt) ||
    !isStringOrNull(item.lastSyncAt) ||
    !isStringOrNull(item.lastErrorAt) ||
    !isStringOrNull(item.lastErrorCode) ||
    !isStringOrNull(item.lastErrorMessage) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconCalendarConnectionId,
    organizationId: item.organizationId,
    staffProfileId: item.staffProfileId,
    provider: item.provider,
    externalAccountEmail: item.externalAccountEmail,
    externalCalendarId: item.externalCalendarId,
    status: item.status,
    scopesGranted: item.scopesGranted,
    accessTokenCiphertext: item.accessTokenCiphertext,
    refreshTokenCiphertext: item.refreshTokenCiphertext,
    tokenExpiresAt: item.tokenExpiresAt,
    connectedAt: item.connectedAt,
    disconnectedAt: item.disconnectedAt,
    lastSyncAt: item.lastSyncAt,
    lastErrorAt: item.lastErrorAt,
    lastErrorCode: item.lastErrorCode,
    lastErrorMessage: item.lastErrorMessage,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixCalendarConnectionData(connection: CalendarConnection): WixCalendarConnectionItem {
  return {
    beaconCalendarConnectionId: connection.id,
    organizationId: connection.organizationId,
    staffProfileId: connection.staffProfileId,
    provider: connection.provider,
    externalAccountEmail: connection.externalAccountEmail,
    externalCalendarId: connection.externalCalendarId,
    status: connection.status,
    scopesGranted: connection.scopesGranted,
    accessTokenCiphertext: connection.accessTokenCiphertext,
    refreshTokenCiphertext: connection.refreshTokenCiphertext,
    tokenExpiresAt: connection.tokenExpiresAt,
    connectedAt: connection.connectedAt,
    disconnectedAt: connection.disconnectedAt,
    lastSyncAt: connection.lastSyncAt,
    lastErrorAt: connection.lastErrorAt,
    lastErrorCode: connection.lastErrorCode,
    lastErrorMessage: connection.lastErrorMessage,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

export function applyCalendarConnectionUpdateToWixData(
  existing: WixCalendarConnectionItem,
  patch: Partial<
    Pick<
      CalendarConnection,
      | 'status'
      | 'externalCalendarId'
      | 'scopesGranted'
      | 'accessTokenCiphertext'
      | 'refreshTokenCiphertext'
      | 'tokenExpiresAt'
      | 'disconnectedAt'
      | 'lastSyncAt'
      | 'lastErrorAt'
      | 'lastErrorCode'
      | 'lastErrorMessage'
      | 'updatedAt'
    >
  >,
): WixCalendarConnectionItem {
  const next = { ...existing };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.externalCalendarId !== undefined) next.externalCalendarId = patch.externalCalendarId;
  if (patch.scopesGranted !== undefined) next.scopesGranted = patch.scopesGranted;
  if (patch.accessTokenCiphertext !== undefined) next.accessTokenCiphertext = patch.accessTokenCiphertext;
  if (patch.refreshTokenCiphertext !== undefined) next.refreshTokenCiphertext = patch.refreshTokenCiphertext;
  if (patch.tokenExpiresAt !== undefined) next.tokenExpiresAt = patch.tokenExpiresAt;
  if (patch.disconnectedAt !== undefined) next.disconnectedAt = patch.disconnectedAt;
  if (patch.lastSyncAt !== undefined) next.lastSyncAt = patch.lastSyncAt;
  if (patch.lastErrorAt !== undefined) next.lastErrorAt = patch.lastErrorAt;
  if (patch.lastErrorCode !== undefined) next.lastErrorCode = patch.lastErrorCode;
  if (patch.lastErrorMessage !== undefined) next.lastErrorMessage = patch.lastErrorMessage;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
