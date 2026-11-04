/**
 * Email documents (2026-11). Staff upload a saved email (.eml) to a case —
 * e.g. a next of kin's email authorizing someone else to make the
 * arrangements. The original file is stored unchanged (it is the record);
 * SOLIS only ever READS it, here, to check it is an email and to show it.
 *
 * Shown as text only: an email's HTML is never rendered (it is untrusted
 * content), only converted to plain text for display. The parser
 * (postal-mime) is loaded only when an email is actually parsed, so it
 * never weighs on pages that don't show one.
 */

export const EMAIL_MIME_TYPE = 'message/rfc822';

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/** Whether an uploaded/stored file is an email: its type says so, or the
    browser gave no useful type and the name ends in .eml. */
export function isEmailFile(mimeType: string | null | undefined, fileName: string): boolean {
  const mime = (mimeType ?? '').trim().toLowerCase();
  if (mime === EMAIL_MIME_TYPE) return true;
  return (mime === '' || mime === 'application/octet-stream') && extensionOf(fileName) === 'eml';
}

export type EmailAddress = { name: string; address: string };
export type EmailAttachment = { fileName: string; mimeType: string; size: number; content: Uint8Array };
export type ParsedEmail = {
  from: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  replyTo: EmailAddress[];
  /** ISO timestamp, or null when the email has no readable date. */
  date: string | null;
  subject: string;
  /** The message as plain text (from its text part, else its HTML as text). */
  text: string;
  attachments: EmailAttachment[];
};

export class EmailParseError extends Error {
  constructor() {
    super("This file couldn't be read as an email. Save the message from your email program as a .eml file and upload that.");
    this.name = 'EmailParseError';
  }
}

type PostalAddress = { name?: string; address?: string; group?: PostalAddress[] };

function flatten(list: PostalAddress[] | PostalAddress | undefined): EmailAddress[] {
  const items = Array.isArray(list) ? list : list ? [list] : [];
  return items.flatMap((a) => (a.group ? flatten(a.group) : a.address || a.name ? [{ name: (a.name ?? '').trim(), address: (a.address ?? '').trim() }] : []));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** An email's HTML as readable plain text — for display as TEXT only (the
    result is never inserted as HTML anywhere). */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity[0] === '#') {
        const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parses an email. Throws EmailParseError when the bytes are not an email
 * (no sender, recipient, date or subject header could be read).
 */
export async function parseEmail(bytes: ArrayBuffer | Uint8Array): Promise<ParsedEmail> {
  const { default: PostalMime } = await import('postal-mime');
  let parsed: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    parsed = await PostalMime.parse(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { attachmentEncoding: 'arraybuffer' });
  } catch {
    throw new EmailParseError();
  }
  const from = flatten(parsed.from as PostalAddress | undefined)[0] ?? null;
  const to = flatten(parsed.to as PostalAddress[] | undefined);
  const cc = flatten(parsed.cc as PostalAddress[] | undefined);
  const replyTo = flatten(parsed.replyTo as PostalAddress[] | undefined);
  const subject = (parsed.subject ?? '').trim();
  const dateMs = parsed.date ? Date.parse(parsed.date) : NaN;
  if (!from && to.length === 0 && !subject && Number.isNaN(dateMs)) throw new EmailParseError();

  const text = parsed.text?.trim() ? parsed.text.trim() : parsed.html ? htmlToPlainText(parsed.html) : '';
  const attachments = (parsed.attachments ?? []).map((a, index) => {
    const content = typeof a.content === 'string' ? new TextEncoder().encode(a.content) : a.content instanceof Uint8Array ? a.content : new Uint8Array(a.content);
    return {
      fileName: (a.filename ?? '').trim() || `attachment-${index + 1}`,
      mimeType: (a.mimeType ?? 'application/octet-stream').toLowerCase(),
      size: content.byteLength,
      content,
    };
  });
  return { from, to, cc, replyTo, date: Number.isNaN(dateMs) ? null : new Date(dateMs).toISOString(), subject, text, attachments };
}

export function formatEmailAddress(address: EmailAddress): string {
  if (address.name && address.address) return `${address.name} <${address.address}>`;
  return address.address || address.name;
}
