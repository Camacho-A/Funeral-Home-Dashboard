import type { FaxConfigurationHistoryEntry, FaxSettingsOverview } from '@/services/faxSettings/faxSettingsService';

/** Fax Settings (2026-11). Client wrappers; errors throw with the server's message. */
export type { FaxConfigurationHistoryEntry, FaxSettingsOverview };

export class FaxSettingsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'FaxSettingsRequestError';
  }
}

async function parse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new FaxSettingsRequestError(typeof body.error === 'string' ? body.error : fallback, response.status);
  return body as T;
}
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const BASE = '/api/organization/fax-settings';

export async function fetchFaxSettings(organizationId: string): Promise<FaxSettingsOverview> {
  return (await parse<{ overview: FaxSettingsOverview }>(await fetch(`${BASE}?${new URLSearchParams({ organizationId })}`, { cache: 'no-store' }), 'Fax Settings could not be loaded.')).overview;
}

export async function fetchFaxConfigurationHistory(organizationId: string): Promise<FaxConfigurationHistoryEntry[]> {
  return (await parse<{ history: FaxConfigurationHistoryEntry[] }>(await fetch(`${BASE}/history?${new URLSearchParams({ organizationId })}`, { cache: 'no-store' }), 'The history could not be loaded.')).history;
}

export type FaxSettingsChanges = { expectedRevision: number | null; providerKey?: string; subjectTemplate?: string; bodyEnabled?: boolean; bodyTemplate?: string; coverPageEnabled?: boolean };

export async function saveFaxSettings(organizationId: string, settings: FaxSettingsChanges): Promise<FaxSettingsOverview> {
  return (await parse<{ overview: FaxSettingsOverview }>(await fetch(BASE, json({ organizationId, settings }, 'PATCH')), 'Fax Settings could not be saved.')).overview;
}

export async function addFaxDestination(organizationId: string, destination: { name: string; faxNumber: string; purpose: string; makeDefault: boolean }): Promise<FaxSettingsOverview> {
  return (await parse<{ overview: FaxSettingsOverview }>(await fetch(`${BASE}/destinations`, json({ organizationId, destination })), 'The destination could not be saved.')).overview;
}

export async function editFaxDestination(organizationId: string, destinationId: string, destination: { expectedRevision: number; name: string; faxNumber: string; purpose: string }): Promise<FaxSettingsOverview> {
  return (await parse<{ overview: FaxSettingsOverview }>(await fetch(`${BASE}/destinations/${encodeURIComponent(destinationId)}`, json({ organizationId, destination }, 'PATCH')), 'The destination could not be saved.')).overview;
}

export async function archiveFaxDestination(organizationId: string, destinationId: string, expectedRevision: number): Promise<FaxSettingsOverview> {
  return (await parse<{ overview: FaxSettingsOverview }>(await fetch(`${BASE}/destinations/${encodeURIComponent(destinationId)}/archive`, json({ organizationId, expectedRevision })), 'The destination could not be archived.')).overview;
}

export async function restoreFaxDestination(organizationId: string, destinationId: string, expectedRevision: number): Promise<FaxSettingsOverview> {
  return (await parse<{ overview: FaxSettingsOverview }>(await fetch(`${BASE}/destinations/${encodeURIComponent(destinationId)}/restore`, json({ organizationId, expectedRevision })), 'The destination could not be restored.')).overview;
}

export async function makeDefaultFaxDestination(organizationId: string, destinationId: string, expectedSettingsRevision: number | null): Promise<FaxSettingsOverview> {
  return (await parse<{ overview: FaxSettingsOverview }>(await fetch(`${BASE}/destinations/${encodeURIComponent(destinationId)}/default`, json({ organizationId, expectedSettingsRevision })), 'The default destination could not be changed.')).overview;
}
