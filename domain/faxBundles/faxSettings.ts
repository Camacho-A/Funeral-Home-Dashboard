import { getRegisteredOrganizationProfile } from '../organization/organizationProfiles';

/**
 * Manatee County DC application fax bundles (2026-11) — where a bundle is
 * faxed and how. One combined PDF, one Outlook email from the
 * organization's connected mailbox to NuSo's email-to-fax gateway
 * (`{10-digit number}@{gateway}`), one fax transmission.
 *
 * The destination lives in the organization's profile (code), so only a
 * reviewed deploy can change it — never a request. The email address is
 * rebuilt from these settings every time; nothing from the browser is
 * ever used as a recipient.
 */
export type DeathCertificateFaxSettings = {
  /** Shown to staff, e.g. "Manatee County Vital Statistics". */
  destinationName: string;
  /** The recipient fax number, 10 digits. */
  faxNumber: string;
  /** NuSo's email-to-fax domain. Must be on GATEWAY_DOMAINS. */
  gatewayDomain: string;
  /** How the organization names itself in the subject. */
  emailOrganizationName: string;
  /** Largest bundle PDF accepted (bytes) — see faxAttachmentLimit. */
  maxAttachmentBytes: number;
  /** Off until the sender, NuSo account and a controlled test delivery are
      verified. Previews still work while it is off; nothing can be sent. */
  sendingEnabled: boolean;
};

/** Email-to-fax gateways SOLIS may send to. */
export const GATEWAY_DOMAINS: readonly string[] = ['fax.nuso.io'];

export const MAX_APPLICATIONS_PER_BUNDLE = 20;

/**
 * Exchange Online's default message size limit is 35 MB, measured on the
 * encoded message (attachments grow ~4/3 when base64-encoded), so an
 * attachment above ~25 MB can be refused whatever the profile says.
 */
export const OUTLOOK_ATTACHMENT_CEILING_BYTES = 25 * 1024 * 1024;

/**
 * Empty on purpose (2026-11). Email-to-fax services commonly turn any email
 * body text into an extra fax page (a cover page); a controlled Outlook test
 * through NuSo turned a one-page PDF with a message and signature into a
 * three-page fax. With no body, the fax should carry only the attachment's
 * pages — to be confirmed by a controlled test before sending is turned on.
 * Sent as plain text, so no HTML wrapper or styling travels either.
 */
export const FAX_EMAIL_BODY = '';

export class FaxSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaxSettingsError';
  }
}

export function deathCertificateFaxSettings(organizationId: string | null | undefined): DeathCertificateFaxSettings | null {
  return organizationId ? getRegisteredOrganizationProfile(organizationId).features.deathCertificateFax : null;
}

/** The gateway address for these settings, validated. Throws FaxSettingsError. */
export function faxDestinationAddress(settings: Pick<DeathCertificateFaxSettings, 'faxNumber' | 'gatewayDomain'>): string {
  if (!/^\d{10}$/.test(settings.faxNumber)) throw new FaxSettingsError('The fax number must be exactly 10 digits.');
  const domain = settings.gatewayDomain.trim().toLowerCase();
  if (!GATEWAY_DOMAINS.includes(domain)) throw new FaxSettingsError('The fax gateway is not an approved email-to-fax service.');
  return `${settings.faxNumber}@${domain}`;
}

/** "9415545490" → "941-554-5490". */
export function formatFaxNumber(faxNumber: string): string {
  return /^\d{10}$/.test(faxNumber) ? `${faxNumber.slice(0, 3)}-${faxNumber.slice(3, 6)}-${faxNumber.slice(6)}` : faxNumber;
}

/** No decedent information — only the organization and the bundle's own reference. */
export function faxSubject(emailOrganizationName: string, reference: string): string {
  return `${emailOrganizationName} - DC Application Bundle ${reference}`;
}

/** The largest bundle that may be attached: the profile's limit, never above Outlook's ceiling. */
export function faxAttachmentLimit(settings: Pick<DeathCertificateFaxSettings, 'maxAttachmentBytes'>): number {
  return Math.min(settings.maxAttachmentBytes, OUTLOOK_ATTACHMENT_CEILING_BYTES);
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
