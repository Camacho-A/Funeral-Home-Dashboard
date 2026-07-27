import type { LoginActivityEvent, LoginActivityEventType } from '../types/loginActivityEvent';

const VALID_EVENT_TYPES: LoginActivityEventType[] = [
  'login_succeeded',
  'login_failed',
  'password_reset',
  'email_verified',
  'invitation_accepted',
  'mfa_enabled',
  'mfa_disabled',
  'session_revoked',
];

function isValidEventType(value: unknown): value is LoginActivityEventType {
  return typeof value === 'string' && (VALID_EVENT_TYPES as string[]).includes(value);
}

export type WixLoginActivityEventItem = {
  beaconEventId?: unknown;
  identityId?: unknown;
  organizationId?: unknown;
  eventType?: unknown;
  ipAddress?: unknown;
  userAgent?: unknown;
  timestamp?: unknown;
};

export function mapWixLoginActivityEventItem(item: WixLoginActivityEventItem | undefined): LoginActivityEvent | null {
  if (!item || typeof item.beaconEventId !== 'string' || !isValidEventType(item.eventType) || typeof item.timestamp !== 'string') {
    return null;
  }

  return {
    id: item.beaconEventId,
    identityId: typeof item.identityId === 'string' ? item.identityId : null,
    organizationId: typeof item.organizationId === 'string' ? item.organizationId : null,
    eventType: item.eventType,
    ipAddress: typeof item.ipAddress === 'string' ? item.ipAddress : null,
    userAgent: typeof item.userAgent === 'string' ? item.userAgent : null,
    timestamp: item.timestamp,
  };
}

export function buildWixLoginActivityEventData(event: LoginActivityEvent): WixLoginActivityEventItem {
  return {
    beaconEventId: event.id,
    identityId: event.identityId,
    organizationId: event.organizationId,
    eventType: event.eventType,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    timestamp: event.timestamp,
  };
}
