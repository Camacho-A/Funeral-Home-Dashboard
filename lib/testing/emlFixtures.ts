/**
 * TEST-ONLY (2026-11). Fictional saved emails (.eml) — every name, address
 * and message is invented.
 */
const CRLF = '\r\n';
const lines = (...l: string[]) => l.join(CRLF);

/** A next of kin authorizing someone else to make the arrangements. */
export const NOK_AUTHORIZATION_EML = lines(
  'From: "Maria Fictional" <maria.fictional@example.com>',
  'To: Arrangements <arrangements@funeralhome.example>',
  'Cc: "Jose Fictional" <jose.fictional@example.com>',
  'Date: Mon, 02 Nov 2026 09:15:00 -0500',
  'Subject: Authorization for my brother to make the arrangements',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'To whom it may concern,',
  '',
  'I, Maria Fictional, daughter of John Fictional, authorize my brother',
  'Jose Fictional to make all funeral arrangements on my behalf.',
  '',
  'Maria',
);

/** Multipart with a PDF attachment (a signed letter). */
export const WITH_ATTACHMENT_EML = lines(
  'From: maria.fictional@example.com',
  'To: arrangements@funeralhome.example',
  'Date: Mon, 02 Nov 2026 10:00:00 -0500',
  'Subject: Signed authorization attached',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Please find my signed letter attached.',
  '--b1',
  'Content-Type: application/pdf; name="authorization.pdf"',
  'Content-Disposition: attachment; filename="authorization.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('%PDF-1.4 fictional').toString('base64'),
  '--b1--',
  '',
);

/** HTML only, with a script that must never run or be shown as markup. */
export const HTML_ONLY_EML = lines(
  'From: "Maria Fictional" <maria.fictional@example.com>',
  'To: arrangements@funeralhome.example',
  'Date: Mon, 02 Nov 2026 11:00:00 -0500',
  'Subject: =?UTF-8?B?QXV0b3JpemFjacOzbg==?=',
  'MIME-Version: 1.0',
  'Content-Type: text/html; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  '<html><head><style>p{color:red}</style></head><body><script>alert(1)</script>',
  '<p>Jos=C3=A9 may sign &amp; decide.</p><p>Thank you<br>Maria</p></body></html>',
);

/** Plain text that LOOKS like markup — must be shown literally. */
export const TEXT_WITH_MARKUP_EML = lines(
  'From: maria.fictional@example.com',
  'To: arrangements@funeralhome.example',
  'Subject: Literal text',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Ignore this: <img src=x onerror=alert(1)><script>alert(2)</script>',
);

export const toBytes = (eml: string) => new TextEncoder().encode(eml);
