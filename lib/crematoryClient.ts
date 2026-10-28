import type { CrematoryReadiness } from '@/domain/crematory/crematoryReadiness';
import type { CaseCrematoryRecord } from '@/types/case';

/** Send to Crematory (2026-10). Client wrappers; errors throw with the server's message. */
export type CrematoryCaseSummary = {
  caseId: string;
  caseNumber: string;
  decedentDisplayName: string;
  packageName: { confirmed: { first: string; last: string } | null; suggested: { first: string; last: string } | null };
  subjectName: string;
  readiness: CrematoryReadiness;
  permit: { documentId: string; fileName: string; createdAt: string; uploadedBy: string | null } | null;
  readyDate: { suggested: string | null; confirmed: string | null };
  package: { documentId: string; version: number | null; fileName: string; current: boolean } | null;
  expectedFileName: string | null;
  lastSubmission: CaseCrematoryRecord['lastSubmission'] | null;
};
export type CrematoryMailbox = { connected: false; configured: boolean } | { connected: true; configured: boolean; accountEmail: string; status: 'connected' | 'reauth_required'; connectedAt: string; connectedBy: string };
export type CrematoryOverview = {
  candidates: CrematoryCaseSummary[];
  settings: { to: string[]; cc: string[] };
  mailbox: CrematoryMailbox;
  organizationName: string;
  /** Send Crematory Packages permission (sending and resending). */
  canSend: boolean;
  /** Document permission: confirm, build and prepare. */
  canPrepare: boolean;
};
export type CrematorySendResult = {
  status: 'submitted';
  duplicate: boolean;
  mailbox: string;
  internetMessageId: string | null;
  to: string[];
  cc: string[];
  attachments: Array<{ caseId: string; caseNumber: string; decedentDisplayName: string; attachmentName: string; packageDocumentId: string; packageVersion: number | null }>;
};

/** A refusal the page can act on (e.g. "already sent — send again?"). */
export class CrematoryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function parse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new CrematoryRequestError(typeof body.error === 'string' ? body.error : fallback, response.status);
  return body as T;
}
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function fetchCrematoryOverview(organizationId: string, caseId?: string): Promise<CrematoryOverview> {
  const params = new URLSearchParams({ organizationId, ...(caseId ? { caseId } : {}) });
  return parse(await fetch(`/api/crematory?${params}`, { cache: 'no-store' }), 'Could not load cases for the crematory.');
}

export async function crematoryCaseAction(
  organizationId: string,
  caseId: string,
  action:
    | { action: 'confirm_permit'; documentId: string }
    | { action: 'confirm_ready_date'; date: string }
    | { action: 'confirm_package_name'; first: string; last: string }
    | { action: 'build_package' },
): Promise<unknown> {
  return parse(await fetch(`/api/cases/${encodeURIComponent(caseId)}/crematory`, json({ organizationId, ...action })), 'The change could not be saved.');
}

export async function sendToCrematory(body: {
  organizationId: string;
  caseIds: string[];
  to: string[];
  cc: string[];
  subject: string;
  message: string;
  submissionId: string;
  confirmResend: boolean;
}): Promise<CrematorySendResult> {
  return parse(await fetch('/api/crematory/send', json(body)), 'The email could not be sent.');
}

export async function fetchCrematorySettings(organizationId: string): Promise<{ settings: { to: string[]; cc: string[] }; mailbox: CrematoryMailbox }> {
  return parse(await fetch(`/api/organization/crematory-settings?${new URLSearchParams({ organizationId })}`, { cache: 'no-store' }), 'Could not load crematory settings.');
}

export async function saveCrematorySettings(organizationId: string, settings: { to: string[]; cc: string[] }): Promise<{ settings: { to: string[]; cc: string[] } }> {
  return parse(await fetch('/api/organization/crematory-settings', json({ organizationId, settings }, 'PATCH')), 'The settings could not be saved.');
}

export async function startCrematoryMailboxConnection(organizationId: string): Promise<{ authorizeUrl: string }> {
  return parse(await fetch('/api/organization/crematory-settings/mailbox', json({ organizationId })), 'Could not start the Microsoft sign-in.');
}

export async function disconnectCrematoryMailbox(organizationId: string): Promise<void> {
  await parse(await fetch(`/api/organization/crematory-settings/mailbox?${new URLSearchParams({ organizationId })}`, { method: 'DELETE' }), 'Could not disconnect the mailbox.');
}
