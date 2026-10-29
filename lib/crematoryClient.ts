import type { CrematoryReadiness } from '@/domain/crematory/crematoryReadiness';
import type { CaseCrematoryRecord } from '@/types/case';
import type { CrematorySourceKind, UntypedCaseDocument } from '@/domain/crematory/crematoryPackage';

/** Send to Crematory (2026-10). Client wrappers; errors throw with the server's message. */
export type CrematoryCaseSummary = {
  caseId: string;
  caseNumber: string;
  decedentDisplayName: string;
  packageName: {
    confirmed: { first: string; last: string } | null;
    suggested: { first: string; last: string } | null;
    /** 'form': the family's own first/middle/last boxes; 'case_name': a two-word case name. */
    suggestedFrom: 'form' | 'case_name' | null;
    /** Who recorded the name: staff, or SOLIS from the intake form (2026-10). */
    recordedFrom: 'staff' | 'intake_form' | null;
  };
  subjectName: string;
  readiness: CrematoryReadiness;
  permit: { documentId: string; fileName: string; createdAt: string; uploadedBy: string | null } | null;
  readyDate: { suggested: string | null; confirmed: string | null; recordedFrom: 'staff' | 'expected_pickup' | null };
  package: { documentId: string; version: number | null; fileName: string; current: boolean } | null;
  expectedFileName: string | null;
  lastSubmission: CaseCrematoryRecord['lastSubmission'] | null;
  /** Active, untyped PDFs on the case staff may choose as the permit or Arrangement Form. */
  untypedDocuments: UntypedCaseDocument[];
  /** One case's own status (GET /api/cases/[id]/crematory, 2026-10): whether
      this staff member may prepare — confirm, replace the permit. */
  canPrepare?: boolean;
  /** Workflow 2 as the case shows it, with the steps not yet checked (2026-10). */
  workflow2: { displayStage: number; medicalExaminer: boolean; missing: string[] } | null;
  /** A possible earlier send outside SOLIS (2026-10). */
  previousSend: { indicated: boolean; recorded: CaseCrematoryRecord['previousSend'] | null };
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
/** The final review (2026-10): the exact email Confirm & Send would send, and its fingerprint. */
export type CrematoryReview = {
  fingerprint: string;
  cases: Array<{
    caseId: string;
    caseNumber: string;
    decedentDisplayName: string;
    subjectName: string;
    expectedReadyDate: string;
    readyDateFrom: 'staff' | 'expected_pickup';
    attachmentName: string;
    packageDocumentId: string;
    packageVersion: number | null;
    packageChecksumSha256: string;
    permit: { documentId: string; fileName: string; verifiedBy: string | null; verifiedByName: string | null; verifiedAt: string };
    lastSendUnclear: boolean;
  }>;
  to: string[];
  cc: string[];
  subject: string;
  message: string;
  mailbox: string | null;
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

/** One case's Crematory Package status (readiness, permit, package). */
export async function fetchCrematoryCaseSummary(organizationId: string, caseId: string): Promise<CrematoryCaseSummary> {
  const params = new URLSearchParams({ organizationId });
  return parse(await fetch(`/api/cases/${encodeURIComponent(caseId)}/crematory?${params}`, { cache: 'no-store' }), 'Could not load the Crematory Package status.');
}

export async function crematoryCaseAction(
  organizationId: string,
  caseId: string,
  action:
    | { action: 'confirm_permit'; documentId: string }
    | { action: 'confirm_ready_date'; date: string }
    | { action: 'confirm_package_name'; first: string; last: string }
    | { action: 'build_package' }
    | { action: 'prepare' }
    | { action: 'assign_document'; documentId: string; as: CrematorySourceKind }
    | { action: 'choose_current_permit'; documentId: string }
    | { action: 'record_previous_send'; decision: 'sent_outside_solis' | 'not_previously_sent'; method?: string; sentOn?: string; verification: string; confirmedChecked?: boolean },
): Promise<unknown> {
  return parse(await fetch(`/api/cases/${encodeURIComponent(caseId)}/crematory`, json({ organizationId, ...action })), 'The change could not be saved.');
}

/** Read-only: what Confirm & Send would send for these cases. */
export async function reviewCrematorySend(organizationId: string, caseIds: string[]): Promise<CrematoryReview> {
  return parse(await fetch('/api/crematory/review', json({ organizationId, caseIds })), 'Could not prepare the email for review.');
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
  /** From reviewCrematorySend — the server refuses a send that differs from it. */
  reviewFingerprint: string;
  /** Staff confirmed the review. */
  acknowledged: boolean;
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
