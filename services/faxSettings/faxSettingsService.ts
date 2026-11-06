import type { DataAdapterMode } from '@/lib/env';
import type { ActivityContext } from '../activityService';
import { attachActorDisplayNames, listForOrganization, recordFaxConfigurationEvent } from '../activityService';
import { ACTIVITY_EVENT_TYPES } from '@/types/activityEvent';
import { canManageOrganization } from '../authorizationPolicyService';
import { getCrematoryMailboxStatus } from '../crematory/crematoryMailboxService';
import { FaxSettingsError, deathCertificateFaxSettings, faxDestinationAddress, formatFaxNumber, type DeathCertificateFaxSettings } from '@/domain/faxBundles/faxSettings';
import { EXTRA_PAGES_WARNING, FAX_PROVIDERS, canUse, faxProvider, type FaxCapability, type FaxProvider, type FaxProviderKey } from '@/domain/faxBundles/faxProviders';
import {
  FAX_TEMPLATE_PLACEHOLDERS,
  FaxTemplateError,
  defaultSubjectTemplate,
  renderFaxTemplate,
  validateBodyTemplate,
  validateSubjectTemplate,
  type FaxTemplateValues,
} from '@/domain/faxBundles/faxTemplates';
import {
  FAX_CONFIGURATION_RECORD_VERSION,
  FaxConfigurationError,
  normalizeDestinationName,
  normalizeDestinationPurpose,
  normalizeFaxNumber,
  type FaxDestination,
  type FaxSettingsRecord,
} from '@/domain/faxBundles/faxConfiguration';
import {
  faxSettingsId,
  getFaxDestination,
  getFaxSettingsRecord,
  insertFaxDestination,
  insertFaxSettingsRecord,
  listFaxDestinationRecords,
  newFaxDestinationId,
  updateFaxDestinationIf,
  updateFaxSettingsIf,
} from './faxSettingsStore';

/**
 * Fax Settings (2026-11) — the ONE owner of an organization's fax
 * configuration: its destinations, provider, subject and message templates
 * and cover page choice. Routes and UI delegate here; only this module
 * writes the faxDestinations / faxSettings collections and records the
 * fax_settings.* / fax_destination.* audit events (structural test in
 * faxSettingsService.test.ts).
 *
 *   resolveFaxConfiguration  what a bundle preview uses right now. With no
 *                            stored settings or destinations it is exactly
 *                            the organization profile's built-in values
 *                            (for Manors: Manatee County Vital Statistics,
 *                            9415545490@fax.nuso.io, "Manors Cremation - DC
 *                            Application Bundle {reference}", no message,
 *                            no cover page) — so nothing changes until an
 *                            administrator saves something.
 *   update / create / archive / default
 *                            administrators only (organization.manage),
 *                            checked HERE from the member's role in this
 *                            organization as well as by the route; each
 *                            write is conditioned on the record's revision;
 *                            each change is one audit event.
 *
 * Never here: turning fax sending on (organization profile, code only), the
 * attachment size limit, and provider capabilities (faxProviders.ts).
 */

export class FaxSettingsServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'FaxSettingsServiceError';
  }
}

// ---------------------------------------------------------------- resolution

export type EffectiveFaxDestination = {
  /** null: the built-in destination from the organization profile. */
  id: string | null;
  name: string;
  faxNumber: string;
  address: string;
  builtIn: boolean;
};

export type EffectiveFaxConfiguration = {
  organizationId: string;
  provider: FaxProvider;
  destination: EffectiveFaxDestination;
  subjectTemplate: string;
  bodyTemplate: string;
  bodyEnabled: boolean;
  /** Enabled AND the provider is verified for a body. Otherwise the email has none. */
  bodyInUse: boolean;
  coverPageEnabled: boolean;
  /** The settings record's revision; null while the organization has none. */
  settingsRevision: number | null;
  emailOrganizationName: string;
  /** From the organization profile (code), never from settings. */
  sendingEnabled: boolean;
  maxAttachmentBytes: number;
};

function profileOf(organizationId: string): DeathCertificateFaxSettings {
  const profile = deathCertificateFaxSettings(organizationId);
  if (!profile) throw new FaxSettingsServiceError('Faxing is not set up for this organization.', 404);
  return profile;
}

function addressFor(faxNumber: string, provider: FaxProvider): string {
  try {
    return faxDestinationAddress({ faxNumber, gatewayDomain: provider.gatewayDomain });
  } catch (error) {
    if (error instanceof FaxSettingsError) throw new FaxSettingsServiceError(`The fax destination is not valid: ${error.message}`, 503);
    throw error;
  }
}

function providerOf(key: FaxProviderKey): FaxProvider {
  const provider = faxProvider(key);
  if (!provider) throw new FaxSettingsServiceError('The fax provider is not an approved email-to-fax service.', 503);
  return provider;
}

/** The provider an organization uses when it has saved nothing: the one serving its profile's gateway. */
function profileProvider(profile: DeathCertificateFaxSettings): FaxProvider {
  const provider = Object.values(FAX_PROVIDERS).find((p) => p.gatewayDomain === profile.gatewayDomain.trim().toLowerCase());
  if (!provider) throw new FaxSettingsServiceError('The fax provider is not an approved email-to-fax service.', 503);
  return providerOf(provider.key);
}

function builtInDestination(profile: DeathCertificateFaxSettings, provider: FaxProvider): EffectiveFaxDestination {
  return { id: null, name: profile.destinationName, faxNumber: profile.faxNumber, address: addressFor(profile.faxNumber, provider), builtIn: true };
}

function settingsDefaults(organizationId: string, profile: DeathCertificateFaxSettings, now: string, actor: string | null): FaxSettingsRecord {
  return {
    id: faxSettingsId(organizationId),
    organizationId,
    providerKey: profileProvider(profile).key,
    defaultDestinationId: null,
    subjectTemplate: defaultSubjectTemplate(profile.emailOrganizationName),
    bodyEnabled: false,
    bodyTemplate: '',
    coverPageEnabled: false,
    revision: 0,
    recordVersion: FAX_CONFIGURATION_RECORD_VERSION,
    createdAt: now,
    createdBy: actor,
    updatedAt: now,
    updatedBy: actor,
  };
}

/**
 * What a preview uses right now. Throws FaxSettingsServiceError (nothing is
 * prepared) when the configuration cannot be used — e.g. the chosen default
 * destination has been archived.
 *
 * `destinationId` (2026-11, destination per bundle): one of THIS
 * organization's active destinations, chosen by staff. Omitted, null or
 * 'builtin' = the organization's default. Another organization's id is
 * simply not found — every read is filtered by organizationId.
 */
export async function resolveFaxConfiguration(organizationId: string, mode: DataAdapterMode, destinationId?: string | null): Promise<EffectiveFaxConfiguration> {
  const profile = profileOf(organizationId);
  const stored = await getFaxSettingsRecord(organizationId, mode);
  const provider = stored ? providerOf(stored.providerKey) : profileProvider(profile);
  const chosen = destinationId && destinationId !== BUILT_IN_DESTINATION_ID ? destinationId : null;

  let destination: EffectiveFaxDestination;
  if (chosen) {
    const record = await getFaxDestination(organizationId, chosen, mode);
    if (!record) throw new FaxSettingsServiceError('That fax destination was not found for your organization.', 404);
    if (record.status !== 'active') throw new FaxSettingsServiceError(`${record.name} has been archived and can no longer be faxed to. Choose another destination.`, 409);
    if (record.providerKey !== provider.key) throw new FaxSettingsServiceError(`${record.name} uses a different provider than Fax Settings. Choose another destination.`, 409);
    destination = { id: record.id, name: record.name, faxNumber: record.faxNumber, address: addressFor(record.faxNumber, providerOf(record.providerKey)), builtIn: false };
  } else if (stored?.defaultDestinationId) {
    const record = await getFaxDestination(organizationId, stored.defaultDestinationId, mode);
    if (!record || record.status !== 'active') throw new FaxSettingsServiceError('The default fax destination is no longer available. An administrator must choose one in Settings → Fax Settings.', 409);
    destination = { id: record.id, name: record.name, faxNumber: record.faxNumber, address: addressFor(record.faxNumber, providerOf(record.providerKey)), builtIn: false };
    if (record.providerKey !== provider.key) throw new FaxSettingsServiceError('The default fax destination uses a different provider than Fax Settings. An administrator must correct it.', 409);
  } else {
    destination = builtInDestination(profile, provider);
  }

  const bodyEnabled = stored?.bodyEnabled === true;
  return {
    organizationId,
    provider,
    destination,
    subjectTemplate: stored?.subjectTemplate || defaultSubjectTemplate(profile.emailOrganizationName),
    bodyTemplate: stored?.bodyTemplate ?? '',
    bodyEnabled,
    bodyInUse: bodyEnabled && canUse(provider.emailBody),
    coverPageEnabled: stored?.coverPageEnabled === true && canUse(provider.coverPage),
    settingsRevision: stored ? stored.revision : null,
    emailOrganizationName: profile.emailOrganizationName,
    sendingEnabled: profile.sendingEnabled === true,
    maxAttachmentBytes: profile.maxAttachmentBytes,
  };
}

/** The subject and message for one bundle. The message is empty unless it is enabled and the provider is verified for one. */
export function renderBundleEmail(config: EffectiveFaxConfiguration, bundle: { reference: string; applicationCount: number; pageCount: number }): { subject: string; body: string } {
  const values: FaxTemplateValues = { reference: bundle.reference, organizationName: config.emailOrganizationName, applicationCount: bundle.applicationCount, pageCount: bundle.pageCount };
  return {
    subject: renderFaxTemplate(config.subjectTemplate, values),
    body: config.bodyInUse ? renderFaxTemplate(config.bodyTemplate, values) : '',
  };
}

/** One destination staff may fax to — the Send Fax dialog's choices. Name and number only. */
export type SendableFaxDestination = { id: string; name: string; faxNumberDisplay: string; isDefault: boolean };

/**
 * The organization's active destinations on its current provider, default
 * first. With nothing stored, the built-in destination (id 'builtin').
 * Only this organization's rows are ever read.
 */
export async function listSendableFaxDestinations(organizationId: string, mode: DataAdapterMode): Promise<SendableFaxDestination[]> {
  const profile = profileOf(organizationId);
  const [stored, records] = await Promise.all([getFaxSettingsRecord(organizationId, mode), listFaxDestinationRecords(organizationId, mode)]);
  const provider = stored ? providerOf(stored.providerKey) : profileProvider(profile);
  const defaultId = stored?.defaultDestinationId ?? null;
  const sendable = records
    .filter((d) => d.organizationId === organizationId && d.status === 'active' && d.providerKey === provider.key)
    .sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId) || a.name.localeCompare(b.name))
    .map((d) => ({ id: d.id, name: d.name, faxNumberDisplay: formatFaxNumber(d.faxNumber), isDefault: d.id === defaultId }));
  if (!defaultId) sendable.unshift({ id: BUILT_IN_DESTINATION_ID, name: profile.destinationName, faxNumberDisplay: formatFaxNumber(profile.faxNumber), isDefault: true });
  return sendable;
}

// ---------------------------------------------------------------- overview

export type FaxDestinationView = {
  /** 'builtin' for the organization profile's destination while nothing is stored. */
  id: string;
  name: string;
  faxNumber: string;
  faxNumberDisplay: string;
  address: string;
  purpose: string;
  status: 'active' | 'archived';
  isDefault: boolean;
  builtIn: boolean;
  revision: number | null;
  updatedAt: string | null;
};

export type FaxProviderView = { key: FaxProviderKey; label: string; gatewayDomain: string; emailBody: FaxCapability; coverPage: FaxCapability; notes: string };

export type FaxSettingsOverview = {
  /** How the organization names itself on fax emails — {organizationName}. */
  organizationName: string;
  sendingEnabled: boolean;
  provider: FaxProviderView;
  providers: FaxProviderView[];
  settings: {
    exists: boolean;
    revision: number | null;
    providerKey: FaxProviderKey;
    subjectTemplate: string;
    bodyEnabled: boolean;
    bodyTemplate: string;
    coverPageEnabled: boolean;
    updatedAt: string | null;
  };
  destinations: FaxDestinationView[];
  /** What the next bundle would be sent with. Null when it cannot be (see `problem`). */
  effective: { destinationName: string; address: string; subjectExample: string; bodyInUse: boolean } | null;
  problem: string | null;
  mailbox: { connected: boolean; configured: boolean; accountEmail: string | null; needsReconnect: boolean };
  placeholders: Array<{ key: string; description: string }>;
  warning: string;
};

const providerView = (p: FaxProvider): FaxProviderView => ({ key: p.key, label: p.label, gatewayDomain: p.gatewayDomain, emailBody: p.emailBody, coverPage: p.coverPage, notes: p.notes });

export async function getFaxSettingsOverview(organizationId: string, mode: DataAdapterMode): Promise<FaxSettingsOverview> {
  const profile = profileOf(organizationId);
  const [stored, records, mailbox] = await Promise.all([
    getFaxSettingsRecord(organizationId, mode),
    listFaxDestinationRecords(organizationId, mode),
    getCrematoryMailboxStatus(organizationId, mode).catch(() => ({ connected: false as const, configured: false })),
  ]);
  const provider = stored ? providerOf(stored.providerKey) : profileProvider(profile);
  const defaultId = stored?.defaultDestinationId ?? null;

  const destinations: FaxDestinationView[] = records
    .sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId) || (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'active' ? -1 : 1))
    .map((d) => ({
      id: d.id,
      name: d.name,
      faxNumber: d.faxNumber,
      faxNumberDisplay: formatFaxNumber(d.faxNumber),
      address: `${d.faxNumber}@${FAX_PROVIDERS[d.providerKey].gatewayDomain}`,
      purpose: d.purpose,
      status: d.status,
      isDefault: d.id === defaultId,
      builtIn: false,
      revision: d.revision,
      updatedAt: d.updatedAt,
    }));
  if (!defaultId) {
    const builtIn = builtInDestination(profile, provider);
    destinations.unshift({ id: BUILT_IN_DESTINATION_ID, name: builtIn.name, faxNumber: builtIn.faxNumber, faxNumberDisplay: formatFaxNumber(builtIn.faxNumber), address: builtIn.address, purpose: 'Built-in default', status: 'active', isDefault: true, builtIn: true, revision: null, updatedAt: null });
  }

  let effective: FaxSettingsOverview['effective'] = null;
  let problem: string | null = null;
  try {
    const config = await resolveFaxConfiguration(organizationId, mode);
    const example = renderBundleEmail(config, { reference: 'DC-7Q4K9M', applicationCount: 3, pageCount: 3 });
    effective = { destinationName: config.destination.name, address: config.destination.address, subjectExample: example.subject, bodyInUse: config.bodyInUse };
  } catch (error) {
    if (!(error instanceof FaxSettingsServiceError)) throw error;
    problem = error.message;
  }

  return {
    organizationName: profile.emailOrganizationName,
    sendingEnabled: profile.sendingEnabled === true,
    provider: providerView(provider),
    providers: Object.values(FAX_PROVIDERS).map(providerView),
    settings: {
      exists: stored !== null,
      revision: stored ? stored.revision : null,
      providerKey: provider.key,
      subjectTemplate: stored?.subjectTemplate || defaultSubjectTemplate(profile.emailOrganizationName),
      bodyEnabled: stored?.bodyEnabled === true,
      bodyTemplate: stored?.bodyTemplate ?? '',
      coverPageEnabled: stored?.coverPageEnabled === true,
      updatedAt: stored?.updatedAt ?? null,
    },
    destinations,
    effective,
    problem,
    // The mailbox's address and state only — never a token.
    mailbox: mailbox.connected
      ? { connected: true, configured: mailbox.configured, accountEmail: mailbox.accountEmail, needsReconnect: mailbox.status === 'reauth_required' }
      : { connected: false, configured: mailbox.configured, accountEmail: null, needsReconnect: false },
    placeholders: Object.entries(FAX_TEMPLATE_PLACEHOLDERS).map(([key, description]) => ({ key, description })),
    warning: EXTRA_PAGES_WARNING,
  };
}

// ---------------------------------------------------------------- authorization

async function authorize(ctx: ActivityContext, mode: DataAdapterMode): Promise<void> {
  profileOf(ctx.organizationId);
  // The route checks this too; checked again here from the member's role in
  // this organization (server-side data), so no caller can skip it.
  const allowed = ctx.actorIdentityId && ctx.actorRoleKey ? await canManageOrganization({ identityId: ctx.actorIdentityId, organizationId: ctx.organizationId, roleKey: ctx.actorRoleKey }, mode) : false;
  if (!allowed) throw new FaxSettingsServiceError('Only administrators can change Fax Settings.', 403);
}

const stale = () => new FaxSettingsServiceError('Someone else changed Fax Settings since you opened them. Reload and try again.', 409);

function inputError(error: unknown): never {
  if (error instanceof FaxTemplateError || error instanceof FaxConfigurationError) throw new FaxSettingsServiceError(error.message, 400);
  throw error;
}

function onlyKeys(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FaxSettingsServiceError('The request body is not valid.', 400);
  const record = input as Record<string, unknown>;
  if ('sendingEnabled' in record) throw new FaxSettingsServiceError('Fax sending cannot be turned on from Fax Settings. It is turned on by SOLIS only after a verified test delivery.', 400);
  const unknown = Object.keys(record).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) throw new FaxSettingsServiceError(`Unknown setting: ${unknown.join(', ')}.`, 400);
  return record;
}

/** The organization's settings record, creating it from the built-in values the first time anything is saved. */
async function ensureSettingsRecord(ctx: ActivityContext, mode: DataAdapterMode): Promise<FaxSettingsRecord> {
  const existing = await getFaxSettingsRecord(ctx.organizationId, mode);
  if (existing) return existing;
  const now = new Date().toISOString();
  await insertFaxSettingsRecord(settingsDefaults(ctx.organizationId, profileOf(ctx.organizationId), now, ctx.actorIdentityId), mode);
  // Inserted, or someone else inserted it first — either way read it back.
  const created = await getFaxSettingsRecord(ctx.organizationId, mode);
  if (!created) throw new FaxSettingsServiceError('Fax Settings could not be saved. Please try again.', 503);
  return created;
}

function changed<T extends object>(before: T, after: T, keys: readonly (keyof T)[]) {
  const previous: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  for (const key of keys) {
    if (before[key] !== after[key]) {
      previous[key as string] = before[key];
      next[key as string] = after[key];
    }
  }
  return { previous, next, any: Object.keys(next).length > 0 };
}

// ---------------------------------------------------------------- settings

export type FaxSettingsInput = {
  expectedRevision?: unknown;
  providerKey?: unknown;
  subjectTemplate?: unknown;
  bodyEnabled?: unknown;
  bodyTemplate?: unknown;
  coverPageEnabled?: unknown;
};

const SETTINGS_KEYS = ['expectedRevision', 'providerKey', 'subjectTemplate', 'bodyEnabled', 'bodyTemplate', 'coverPageEnabled'] as const;

/**
 * Saves the provider, subject, message and cover page choice. A message or a
 * cover page can only be switched on when the provider is VERIFIED for it;
 * with an unverified provider the message may be drafted but stays off.
 */
export async function updateFaxSettings(ctx: ActivityContext, rawInput: unknown, mode: DataAdapterMode): Promise<FaxSettingsOverview> {
  await authorize(ctx, mode);
  const input = onlyKeys(rawInput, SETTINGS_KEYS) as FaxSettingsInput;
  const expectedRevision = input.expectedRevision === null || input.expectedRevision === undefined ? null : input.expectedRevision;
  if (expectedRevision !== null && (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision))) throw new FaxSettingsServiceError('expectedRevision must be a whole number or null.', 400);

  const current = await getFaxSettingsRecord(ctx.organizationId, mode);
  if ((current?.revision ?? null) !== expectedRevision) throw stale();
  // Validated against the built-in values when nothing is stored yet; nothing is written until every check passes.
  const record = current ?? settingsDefaults(ctx.organizationId, profileOf(ctx.organizationId), new Date().toISOString(), ctx.actorIdentityId);

  const providerKey = input.providerKey === undefined ? record.providerKey : input.providerKey;
  const provider = faxProvider(providerKey);
  if (!provider) throw new FaxSettingsServiceError('Choose an approved fax provider.', 400);

  let subjectTemplate = record.subjectTemplate;
  let bodyTemplate = record.bodyTemplate;
  try {
    if (input.subjectTemplate !== undefined) subjectTemplate = validateSubjectTemplate(input.subjectTemplate);
    if (input.bodyTemplate !== undefined) bodyTemplate = validateBodyTemplate(input.bodyTemplate);
  } catch (error) {
    inputError(error);
  }
  const bodyEnabled = input.bodyEnabled === undefined ? record.bodyEnabled : input.bodyEnabled;
  const coverPageEnabled = input.coverPageEnabled === undefined ? record.coverPageEnabled : input.coverPageEnabled;
  if (typeof bodyEnabled !== 'boolean' || typeof coverPageEnabled !== 'boolean') throw new FaxSettingsServiceError('bodyEnabled and coverPageEnabled must be true or false.', 400);

  if (bodyEnabled && !canUse(provider.emailBody)) {
    throw new FaxSettingsServiceError(`${provider.label} has not been verified to fax an email message without adding pages, so the message cannot be turned on. You can still draft it.`, 400);
  }
  if (bodyEnabled && !bodyTemplate) throw new FaxSettingsServiceError('Write the message before turning it on.', 400);
  if (provider.emailBody === 'unsupported' && bodyTemplate) throw new FaxSettingsServiceError(`${provider.label} does not accept an email message.`, 400);
  if (coverPageEnabled && !canUse(provider.coverPage)) {
    throw new FaxSettingsServiceError(`${provider.label} has no verified cover page option. SOLIS never creates a cover page itself.`, 400);
  }

  // A stored default destination must belong to the chosen provider.
  if (record.defaultDestinationId && provider.key !== record.providerKey) {
    const destination = await getFaxDestination(ctx.organizationId, record.defaultDestinationId, mode);
    if (destination && destination.providerKey !== provider.key) throw new FaxSettingsServiceError('The default destination uses another provider. Choose a destination for this provider first.', 400);
  }

  const next: FaxSettingsRecord = { ...record, providerKey: provider.key, subjectTemplate, bodyTemplate, bodyEnabled, coverPageEnabled };
  const diff = changed(record, next, ['providerKey', 'subjectTemplate', 'bodyEnabled', 'bodyTemplate', 'coverPageEnabled']);
  if (diff.any || !current) {
    const now = new Date().toISOString();
    // First save: the record is created from the built-in values, then changed — two admins saving first at once: one is told it changed.
    const base = current ?? (await ensureSettingsRecord(ctx, mode));
    if (!current && base.revision !== 0) throw stale();
    const saved = await updateFaxSettingsIf(base, { providerKey: next.providerKey, subjectTemplate, bodyTemplate, bodyEnabled, coverPageEnabled, updatedAt: now, updatedBy: ctx.actorIdentityId }, mode);
    if (!saved) throw stale();
    await recordFaxConfigurationEvent(
      ctx,
      ACTIVITY_EVENT_TYPES.FAX_SETTINGS_UPDATED,
      {
        resourceType: 'faxSettings',
        resourceId: saved.id,
        description: diff.any ? `Fax Settings changed: ${describeSettingsChange(Object.keys(diff.next))}` : 'Fax Settings saved (built-in values)',
        previous: diff.any ? diff.previous : null,
        next: diff.any ? diff.next : { subjectTemplate },
      },
      mode,
    );
  }
  return getFaxSettingsOverview(ctx.organizationId, mode);
}

const SETTING_LABELS: Record<string, string> = { providerKey: 'provider', subjectTemplate: 'email subject', bodyEnabled: 'message on/off', bodyTemplate: 'message text', coverPageEnabled: 'cover page' };
const describeSettingsChange = (keys: string[]) => keys.map((k) => SETTING_LABELS[k] ?? k).join(', ');

// ---------------------------------------------------------------- destinations

export type FaxDestinationInput = { name?: unknown; faxNumber?: unknown; purpose?: unknown; makeDefault?: unknown; expectedRevision?: unknown };

function destinationFields(input: FaxDestinationInput, partial: boolean): { name?: string; faxNumber?: string; purpose?: string } {
  try {
    return {
      ...(input.name !== undefined || !partial ? { name: normalizeDestinationName(input.name) } : {}),
      ...(input.faxNumber !== undefined || !partial ? { faxNumber: normalizeFaxNumber(input.faxNumber) } : {}),
      ...(input.purpose !== undefined || !partial ? { purpose: normalizeDestinationPurpose(input.purpose) } : {}),
    };
  } catch (error) {
    inputError(error);
  }
}

/** The id the settings page uses for the built-in destination while the organization has no stored default. */
export const BUILT_IN_DESTINATION_ID = 'builtin';

async function requireDestination(ctx: ActivityContext, destinationId: unknown, mode: DataAdapterMode): Promise<FaxDestination> {
  if (destinationId === BUILT_IN_DESTINATION_ID) return adoptBuiltInDestination(ctx, mode);
  // Another organization's id simply does not exist here.
  const destination = typeof destinationId === 'string' ? await getFaxDestination(ctx.organizationId, destinationId, mode) : null;
  if (!destination) throw new FaxSettingsServiceError('Fax destination not found.', 404);
  return destination;
}

/**
 * The built-in destination (organization profile) becomes a stored, editable
 * destination — and the default — the first time an administrator edits it
 * or adds another one, so the destination faxes go to never silently
 * changes. Returns the stored default if there already is one.
 */
async function adoptBuiltInDestination(ctx: ActivityContext, mode: DataAdapterMode): Promise<FaxDestination> {
  const settings = await ensureSettingsRecord(ctx, mode);
  if (settings.defaultDestinationId) {
    const current = await getFaxDestination(ctx.organizationId, settings.defaultDestinationId, mode);
    if (current) return current;
  }
  const profile = profileOf(ctx.organizationId);
  const now = new Date().toISOString();
  const destination: FaxDestination = {
    id: newFaxDestinationId(),
    organizationId: ctx.organizationId,
    name: profile.destinationName,
    faxNumber: profile.faxNumber,
    providerKey: settings.providerKey,
    purpose: 'Death certificate applications',
    status: 'active',
    revision: 0,
    recordVersion: FAX_CONFIGURATION_RECORD_VERSION,
    createdAt: now,
    createdBy: ctx.actorIdentityId,
    updatedAt: now,
    updatedBy: ctx.actorIdentityId,
    archivedAt: null,
    archivedBy: null,
  };
  if ((await insertFaxDestination(destination, mode)) !== 'inserted') throw new FaxSettingsServiceError('The destination could not be saved. Please try again.', 503);
  await recordFaxConfigurationEvent(
    ctx,
    ACTIVITY_EVENT_TYPES.FAX_DESTINATION_CREATED,
    { resourceType: 'faxDestination', resourceId: destination.id, description: `Fax destination saved from the built-in default: ${destination.name} (${formatFaxNumber(destination.faxNumber)})`, previous: null, next: { name: destination.name, faxNumber: destination.faxNumber, purpose: destination.purpose, providerKey: destination.providerKey } },
    mode,
  );
  await moveDefault(ctx, settings, destination, mode);
  return destination;
}

async function duplicateNumber(organizationId: string, faxNumber: string, exceptId: string | null, mode: DataAdapterMode): Promise<boolean> {
  return (await listFaxDestinationRecords(organizationId, mode)).some((d) => d.status === 'active' && d.faxNumber === faxNumber && d.id !== exceptId);
}

/** Adds a destination; it becomes the default only with makeDefault. (The built-in destination is stored first, as the default.) */
export async function createFaxDestination(ctx: ActivityContext, rawInput: unknown, mode: DataAdapterMode): Promise<FaxSettingsOverview> {
  await authorize(ctx, mode);
  const input = onlyKeys(rawInput, ['name', 'faxNumber', 'purpose', 'makeDefault']) as FaxDestinationInput;
  const fields = destinationFields(input, false) as { name: string; faxNumber: string; purpose: string };
  if (input.makeDefault !== undefined && typeof input.makeDefault !== 'boolean') throw new FaxSettingsServiceError('makeDefault must be true or false.', 400);
  // The built-in destination is kept (stored, still the default) before another is added.
  let settings = await ensureSettingsRecord(ctx, mode);
  if (!settings.defaultDestinationId) {
    await adoptBuiltInDestination(ctx, mode);
    settings = (await getFaxSettingsRecord(ctx.organizationId, mode)) ?? settings;
  }
  if (await duplicateNumber(ctx.organizationId, fields.faxNumber, null, mode)) throw new FaxSettingsServiceError(`${formatFaxNumber(fields.faxNumber)} is already a destination.`, 409);

  const now = new Date().toISOString();
  const destination: FaxDestination = {
    id: newFaxDestinationId(),
    organizationId: ctx.organizationId,
    ...fields,
    providerKey: settings.providerKey,
    status: 'active',
    revision: 0,
    recordVersion: FAX_CONFIGURATION_RECORD_VERSION,
    createdAt: now,
    createdBy: ctx.actorIdentityId,
    updatedAt: now,
    updatedBy: ctx.actorIdentityId,
    archivedAt: null,
    archivedBy: null,
  };
  if ((await insertFaxDestination(destination, mode)) !== 'inserted') throw new FaxSettingsServiceError('The destination could not be saved. Please try again.', 503);
  await recordFaxConfigurationEvent(
    ctx,
    ACTIVITY_EVENT_TYPES.FAX_DESTINATION_CREATED,
    { resourceType: 'faxDestination', resourceId: destination.id, description: `Fax destination added: ${destination.name} (${formatFaxNumber(destination.faxNumber)})`, previous: null, next: { name: destination.name, faxNumber: destination.faxNumber, purpose: destination.purpose, providerKey: destination.providerKey } },
    mode,
  );
  if (input.makeDefault === true) await moveDefault(ctx, settings, destination, mode);
  return getFaxSettingsOverview(ctx.organizationId, mode);
}

/** Corrects a destination's name, number or purpose. A bundle already prepared for the old number will not send (preview again). */
export async function updateFaxDestination(ctx: ActivityContext, destinationId: unknown, rawInput: unknown, mode: DataAdapterMode): Promise<FaxSettingsOverview> {
  await authorize(ctx, mode);
  const input = onlyKeys(rawInput, ['name', 'faxNumber', 'purpose', 'expectedRevision']) as FaxDestinationInput;
  const builtIn = destinationId === BUILT_IN_DESTINATION_ID;
  const destination = await requireDestination(ctx, destinationId, mode);
  // The built-in destination has no revision until it is stored (just now, at 0).
  if (!builtIn && destination.revision !== input.expectedRevision) throw stale();
  if (destination.status !== 'active') throw new FaxSettingsServiceError('An archived destination cannot be changed.', 409);
  const fields = destinationFields(input, true);
  if (fields.faxNumber && (await duplicateNumber(ctx.organizationId, fields.faxNumber, destination.id, mode))) throw new FaxSettingsServiceError(`${formatFaxNumber(fields.faxNumber)} is already a destination.`, 409);
  const next = { ...destination, ...fields };
  const diff = changed(destination, next, ['name', 'faxNumber', 'purpose']);
  if (!diff.any) return getFaxSettingsOverview(ctx.organizationId, mode);
  const saved = await updateFaxDestinationIf(destination, { ...fields, updatedAt: new Date().toISOString(), updatedBy: ctx.actorIdentityId }, mode);
  if (!saved) throw stale();
  await recordFaxConfigurationEvent(
    ctx,
    ACTIVITY_EVENT_TYPES.FAX_DESTINATION_UPDATED,
    { resourceType: 'faxDestination', resourceId: saved.id, description: `Fax destination changed: ${saved.name} (${formatFaxNumber(saved.faxNumber)})`, previous: diff.previous, next: diff.next },
    mode,
  );
  return getFaxSettingsOverview(ctx.organizationId, mode);
}

/** Archives a destination (kept for history, never deleted). The default cannot be archived — choose another default first. */
export async function archiveFaxDestination(ctx: ActivityContext, destinationId: unknown, expectedRevision: unknown, mode: DataAdapterMode): Promise<FaxSettingsOverview> {
  await authorize(ctx, mode);
  const destination = await requireDestination(ctx, destinationId, mode);
  if (destination.revision !== expectedRevision) throw stale();
  if (destination.status === 'archived') return getFaxSettingsOverview(ctx.organizationId, mode);
  const settings = await getFaxSettingsRecord(ctx.organizationId, mode);
  if (settings?.defaultDestinationId === destination.id) throw new FaxSettingsServiceError('This is the default destination. Choose another default before archiving it.', 409);
  // Never the last usable destination: an active default on the current
  // provider must remain (with no stored default, the built-in one is it).
  const remaining = (await listFaxDestinationRecords(ctx.organizationId, mode)).filter((d) => d.id !== destination.id && d.status === 'active');
  const defaultRemains = settings?.defaultDestinationId ? remaining.some((d) => d.id === settings.defaultDestinationId && d.providerKey === settings.providerKey) : true;
  if (!defaultRemains) throw new FaxSettingsServiceError('This is the last destination faxes can go to. Add another destination and make it the default before archiving this one.', 409);
  const now = new Date().toISOString();
  const saved = await updateFaxDestinationIf(destination, { status: 'archived', archivedAt: now, archivedBy: ctx.actorIdentityId, updatedAt: now, updatedBy: ctx.actorIdentityId }, mode);
  if (!saved) throw stale();
  await recordFaxConfigurationEvent(
    ctx,
    ACTIVITY_EVENT_TYPES.FAX_DESTINATION_ARCHIVED,
    { resourceType: 'faxDestination', resourceId: saved.id, description: `Fax destination archived: ${saved.name} (${formatFaxNumber(saved.faxNumber)})`, previous: { status: 'active' }, next: { status: 'archived' } },
    mode,
  );
  return getFaxSettingsOverview(ctx.organizationId, mode);
}

/** Restores an archived destination to the active list. It does not become the default. */
export async function restoreFaxDestination(ctx: ActivityContext, destinationId: unknown, expectedRevision: unknown, mode: DataAdapterMode): Promise<FaxSettingsOverview> {
  await authorize(ctx, mode);
  if (destinationId === BUILT_IN_DESTINATION_ID) throw new FaxSettingsServiceError('Fax destination not found.', 404);
  const destination = await requireDestination(ctx, destinationId, mode);
  if (destination.revision !== expectedRevision) throw stale();
  if (destination.status === 'active') return getFaxSettingsOverview(ctx.organizationId, mode);
  if (await duplicateNumber(ctx.organizationId, destination.faxNumber, destination.id, mode)) {
    throw new FaxSettingsServiceError(`${formatFaxNumber(destination.faxNumber)} is already an active destination. Archive or change that one first.`, 409);
  }
  const now = new Date().toISOString();
  const saved = await updateFaxDestinationIf(destination, { status: 'active', archivedAt: null, archivedBy: null, updatedAt: now, updatedBy: ctx.actorIdentityId }, mode);
  if (!saved) throw stale();
  await recordFaxConfigurationEvent(
    ctx,
    ACTIVITY_EVENT_TYPES.FAX_DESTINATION_RESTORED,
    { resourceType: 'faxDestination', resourceId: saved.id, description: `Fax destination restored: ${saved.name} (${formatFaxNumber(saved.faxNumber)})`, previous: { status: 'archived' }, next: { status: 'active' } },
    mode,
  );
  return getFaxSettingsOverview(ctx.organizationId, mode);
}

/** Makes this destination the one bundles are faxed to. One conditioned write: never two defaults. */
export async function setDefaultFaxDestination(ctx: ActivityContext, destinationId: unknown, expectedSettingsRevision: unknown, mode: DataAdapterMode): Promise<FaxSettingsOverview> {
  await authorize(ctx, mode);
  const destination = await requireDestination(ctx, destinationId, mode);
  if (destination.status !== 'active') throw new FaxSettingsServiceError('An archived destination cannot be the default.', 409);
  const settings = await getFaxSettingsRecord(ctx.organizationId, mode);
  if (!settings || settings.revision !== expectedSettingsRevision) throw stale();
  if (settings.defaultDestinationId === destination.id) return getFaxSettingsOverview(ctx.organizationId, mode);
  await moveDefault(ctx, settings, destination, mode);
  return getFaxSettingsOverview(ctx.organizationId, mode);
}

async function moveDefault(ctx: ActivityContext, settings: FaxSettingsRecord, destination: FaxDestination, mode: DataAdapterMode): Promise<void> {
  if (destination.providerKey !== settings.providerKey) throw new FaxSettingsServiceError('This destination uses another provider than Fax Settings.', 409);
  const saved = await updateFaxSettingsIf(settings, { defaultDestinationId: destination.id, updatedAt: new Date().toISOString(), updatedBy: ctx.actorIdentityId }, mode);
  if (!saved) throw stale();
  const previous = settings.defaultDestinationId ? await getFaxDestination(ctx.organizationId, settings.defaultDestinationId, mode) : null;
  await recordFaxConfigurationEvent(
    ctx,
    ACTIVITY_EVENT_TYPES.FAX_DESTINATION_DEFAULT_CHANGED,
    {
      resourceType: 'faxSettings',
      resourceId: saved.id,
      description: `Default fax destination: ${destination.name} (${formatFaxNumber(destination.faxNumber)})${previous ? `, was ${previous.name} (${formatFaxNumber(previous.faxNumber)})` : ', was the built-in destination'}`,
      previous: { defaultDestinationId: settings.defaultDestinationId },
      next: { defaultDestinationId: destination.id },
    },
    mode,
  );
}

// ---------------------------------------------------------------- history

export type FaxConfigurationHistoryEntry = { id: string; at: string; eventType: string; description: string; actor: string | null };

/** The Fax Configuration History: the fax_settings.* / fax_destination.* audit events, newest first. */
export async function listFaxConfigurationHistory(organizationId: string, mode: DataAdapterMode, limit = 50): Promise<FaxConfigurationHistoryEntry[]> {
  profileOf(organizationId);
  const results = await Promise.all(
    (['faxSettings', 'faxDestination'] as const).map((resourceType) => listForOrganization(organizationId, { category: 'administration', resourceType }, null, limit, mode)),
  );
  const events = results
    .flatMap((r) => r.events)
    .filter((e) => e.organizationId === organizationId && (e.eventType.startsWith('fax_settings.') || e.eventType.startsWith('fax_destination.')))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, limit);
  return (await attachActorDisplayNames(events, mode)).map((e) => ({ id: e.id, at: e.createdAt, eventType: e.eventType, description: e.description, actor: e.actorDisplayName }));
}

