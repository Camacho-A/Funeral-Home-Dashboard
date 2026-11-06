import { faxDestinationAddress, formatFaxNumber, type DeathCertificateFaxSettings } from './faxSettings';
import { normalizeFaxNumber } from './faxConfiguration';

/**
 * Fax test transmissions (2026-11) — docs/FAX_TEST_TRANSMISSIONS.md.
 *
 * Before real DC application bundles may be faxed, a FICTIONAL test PDF is
 * sent through exactly the path Send Fax uses (the connected Outlook
 * mailbox, Microsoft Graph, an empty plain-text body, one PDF) to a
 * recipient the organization controls, to learn what NuSo and Exchange do
 * to it (cover page? text pages? disclaimer?) — without turning sending on.
 *
 * Three steps — the dry run is optional; the two-page test needs the
 * one-page test to have passed:
 *   0  email dry run   1-page PDF to an approved EMAIL address
 *   1  one-page fax    1-page PDF to an approved fax number
 *   2  two-page fax    2-page PDF to an approved fax number
 *
 * Recipients come only from the organization profile (code): nothing the
 * browser sends is ever an address.
 */

export type FaxTestKind = 'email_dry_run' | 'fax';
export type FaxTestStep = 0 | 1 | 2;
export const FAX_TEST_STEPS: Readonly<Record<FaxTestStep, { kind: FaxTestKind; pages: 1 | 2; label: string }>> = {
  0: { kind: 'email_dry_run', pages: 1, label: 'Email dry run (1-page PDF, no fax)' },
  1: { kind: 'fax', pages: 1, label: 'One-page fax test' },
  2: { kind: 'fax', pages: 2, label: 'Two-page fax test' },
};
export const isFaxTestStep = (value: unknown): value is FaxTestStep => value === 0 || value === 1 || value === 2;

/**
 * contacting   recorded BEFORE Outlook is contacted
 * submitted    Outlook (Graph) accepted the message — not delivery
 * not_sent     nothing went out (an Outlook refusal before the send, or an
 *              administrator confirmed after review that nothing was sent)
 * needs_review the send call's result is unknown: it may have gone out;
 *              never retried — an administrator records what happened
 * nuso_accepted NuSo acknowledged it (its notice, or its outbound log)
 * delivered    received: NuSo's delivery report and our own line (fax),
 *              or the email inspected in the dry-run mailbox
 * failed       NuSo or Exchange reported a failure
 */
export type FaxTestStatus = 'contacting' | 'submitted' | 'not_sent' | 'needs_review' | 'nuso_accepted' | 'delivered' | 'failed';
export const FAX_TEST_FINAL: readonly FaxTestStatus[] = ['not_sent', 'delivered', 'failed'];
export const FAX_TEST_STATUS_LABEL: Readonly<Record<FaxTestStatus, string>> = {
  contacting: 'Contacting Outlook',
  submitted: 'Submitted to Outlook',
  not_sent: 'Not sent',
  needs_review: 'Needs review — may have been sent',
  nuso_accepted: 'Accepted by NuSo',
  delivered: 'Delivered',
  failed: 'Failed',
};

/** What an administrator may record next, from each status. Email dry runs have no NuSo stage. */
export function nextFaxTestStatuses(status: FaxTestStatus, kind: FaxTestKind): FaxTestStatus[] {
  const reported: FaxTestStatus[] = kind === 'fax' ? ['nuso_accepted', 'delivered', 'failed'] : ['delivered', 'failed'];
  if (status === 'submitted') return reported;
  if (status === 'needs_review') return ['not_sent', ...reported];
  if (status === 'nuso_accepted') return ['delivered', 'failed'];
  return [];
}

/** The dry-run inspection of the received email ("Show original"). All must hold to pass. */
export const EMAIL_DRY_RUN_CHECKS = {
  fromConnectedMailbox: 'From the connected mailbox',
  subjectAsExpected: 'Subject exactly as shown here',
  emptyPlainTextBody: 'Body is empty plain text — no signature, disclaimer or footer',
  exactlyOnePdf: 'Exactly one attachment, the PDF (no logo or other images)',
  checksumMatches: 'The attachment’s SHA-256 matches the one shown here',
} as const;
export type EmailDryRunCheck = keyof typeof EMAIL_DRY_RUN_CHECKS;

export type FaxTestRecipient = {
  /** Stable key the browser refers to — never an address it supplies. */
  key: string;
  kind: FaxTestKind;
  /** What the email is sent to. */
  address: string;
  /** What people read: "941-555-0100" or the email address. */
  display: string;
};

const EMAIL = /^[^\s@<>()",;:]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** The approved recipients from the organization profile. Invalid entries are skipped (and reported). */
export function faxTestRecipients(settings: DeathCertificateFaxSettings): { recipients: FaxTestRecipient[]; invalid: string[] } {
  const recipients: FaxTestRecipient[] = [];
  const invalid: string[] = [];
  for (const raw of settings.testRecipients?.faxNumbers ?? []) {
    try {
      const digits = normalizeFaxNumber(raw);
      recipients.push({ key: `fax:${digits}`, kind: 'fax', address: faxDestinationAddress({ faxNumber: digits, gatewayDomain: settings.gatewayDomain }), display: formatFaxNumber(digits) });
    } catch {
      invalid.push(raw);
    }
  }
  for (const raw of settings.testRecipients?.emailAddresses ?? []) {
    const address = raw.trim().toLowerCase();
    // An email-to-fax gateway address is a fax, not a dry run.
    if (!EMAIL.test(address) || address.endsWith(`@${settings.gatewayDomain.toLowerCase()}`)) invalid.push(raw);
    else recipients.push({ key: `email:${address}`, kind: 'email_dry_run', address, display: address });
  }
  return { recipients: recipients.filter((r, i) => recipients.findIndex((x) => x.key === r.key) === i), invalid };
}

export const faxTestAttachmentName = (pages: 1 | 2) => `SOLIS-FAX-TEST-${pages === 1 ? '1-PAGE' : '2-PAGES'}.pdf`;
