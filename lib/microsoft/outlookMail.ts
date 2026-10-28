/**
 * Send to Crematory (2026-10). Sends one Outlook email with PDF attachments
 * from the organization's connected Microsoft 365 mailbox through Microsoft
 * Graph — plain `fetch`, no SDK, like services/calendar/microsoftCalendarProvider.ts.
 *
 * Draft → attach → send, rather than one `sendMail` call: a single Graph
 * request is capped at about 4 MB, and several decedents' packages easily
 * exceed that. Each attachment under 3 MB is added directly; larger ones go
 * through an upload session in chunks. If anything fails before the final
 * send, the draft is deleted, so nothing half-built is left in the mailbox
 * and nothing is sent.
 *
 * A successful call means Outlook ACCEPTED the message for sending — not
 * that it was delivered or read. Callers must record it as "submitted".
 */
const GRAPH = 'https://graph.microsoft.com/v1.0';
const DIRECT_ATTACHMENT_LIMIT = 3 * 1024 * 1024;
/** Upload-session chunks must be a multiple of 320 KiB. */
const UPLOAD_CHUNK = 320 * 1024 * 10;

export type OutlookAttachment = { name: string; contentType: string; bytes: Uint8Array };
export type OutlookMessage = { to: string[]; cc: string[]; subject: string; bodyText: string; attachments: OutlookAttachment[] };
export type OutlookSendResult = { draftId: string; internetMessageId: string | null };

export class OutlookMailError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Whether anything could have been sent. False for every failure
        before the final send call. */
    readonly mayHaveSent: boolean,
  ) {
    super(message);
    this.name = 'OutlookMailError';
  }
}

async function graph(accessToken: string, path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { json, ...rest } = init;
  return fetch(`${GRAPH}${path}`, {
    ...rest,
    headers: { Authorization: `Bearer ${accessToken}`, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
}

async function failure(response: Response, what: string, mayHaveSent = false): Promise<OutlookMailError> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    detail = body.error?.code ? ` (${body.error.code})` : '';
  } catch {
    // no JSON body
  }
  return new OutlookMailError(`Outlook could not ${what}${detail}.`, response.status, mayHaveSent);
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const recipients = (addresses: string[]) => addresses.map((address) => ({ emailAddress: { address } }));

async function attach(accessToken: string, draftId: string, attachment: OutlookAttachment): Promise<void> {
  if (attachment.bytes.byteLength < DIRECT_ATTACHMENT_LIMIT) {
    const response = await graph(accessToken, `/me/messages/${encodeURIComponent(draftId)}/attachments`, {
      method: 'POST',
      json: { '@odata.type': '#microsoft.graph.fileAttachment', name: attachment.name, contentType: attachment.contentType, contentBytes: base64(attachment.bytes) },
    });
    if (!response.ok) throw await failure(response, `attach ${attachment.name}`);
    return;
  }
  const session = await graph(accessToken, `/me/messages/${encodeURIComponent(draftId)}/attachments/createUploadSession`, {
    method: 'POST',
    json: { AttachmentItem: { attachmentType: 'file', name: attachment.name, size: attachment.bytes.byteLength, contentType: attachment.contentType } },
  });
  if (!session.ok) throw await failure(session, `start uploading ${attachment.name}`);
  const { uploadUrl } = (await session.json()) as { uploadUrl: string };
  const total = attachment.bytes.byteLength;
  for (let start = 0; start < total; start += UPLOAD_CHUNK) {
    const end = Math.min(start + UPLOAD_CHUNK, total);
    // The upload URL is pre-authorized; it must NOT carry the bearer token.
    const chunk = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${start}-${end - 1}/${total}`, 'Content-Length': String(end - start) },
      body: attachment.bytes.slice(start, end),
    });
    if (!chunk.ok) throw await failure(chunk, `upload ${attachment.name}`);
  }
}

export async function sendOutlookMessage(accessToken: string, message: OutlookMessage): Promise<OutlookSendResult> {
  if (message.to.length === 0) throw new OutlookMailError('At least one recipient is required.', 400, false);
  const draft = await graph(accessToken, '/me/messages', {
    method: 'POST',
    json: {
      subject: message.subject,
      body: { contentType: 'Text', content: message.bodyText },
      toRecipients: recipients(message.to),
      ccRecipients: recipients(message.cc),
    },
  });
  if (!draft.ok) throw await failure(draft, 'create the email');
  const { id: draftId, internetMessageId } = (await draft.json()) as { id: string; internetMessageId?: string };

  try {
    for (const attachment of message.attachments) await attach(accessToken, draftId, attachment);
  } catch (error) {
    await graph(accessToken, `/me/messages/${encodeURIComponent(draftId)}`, { method: 'DELETE' }).catch(() => undefined);
    throw error;
  }

  const sent = await graph(accessToken, `/me/messages/${encodeURIComponent(draftId)}/send`, { method: 'POST' });
  if (!sent.ok) {
    // A failed send call may or may not have queued the message; never claim it did not.
    throw await failure(sent, 'send the email', sent.status >= 500);
  }
  return { draftId, internetMessageId: internetMessageId ?? null };
}
