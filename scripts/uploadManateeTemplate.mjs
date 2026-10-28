// Uploads Manors' signed Manatee County form (DH 1961) to the app's PRIVATE
// document storage (Vercel Blob), for MANATEE_DC_APPLICATION_TEMPLATE_STORAGE_KEY.
// A Production change: run only with approval. See docs/OFFICIAL_DOCUMENTS.md.
//
//   BLOB_READ_WRITE_TOKEN=… node scripts/uploadManateeTemplate.mjs "<path to the signed PDF>" [--dry-run]
//
// Safe by construction:
//   - refuses a file that is not the approved form (SHA-256 below);
//   - refuses if anything already exists at the key — never overwrites;
//   - uploads private, at exactly the key (no random suffix);
//   - reads the stored file back and checks it is byte-for-byte the same.
// The signed form itself is never added to this repository.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { get, put } from '@vercel/blob';

const STORAGE_KEY = 'managed-cremations/templates/manatee-death-certificate-application.pdf';
/** "GCFH MANATEE COUNTY - Vital Statistics _Fill-In_[857]new_MANORS.pdf", as approved. */
const APPROVED_SHA256 = '4b102fb06af43a6717434cfd0096332c9bd783bd3f378ba53089508d5f4aa9dc';

const [file, flag] = process.argv.slice(2);
const dryRun = flag === '--dry-run';
if (!file) {
  console.error('Usage: node scripts/uploadManateeTemplate.mjs "<path to the signed PDF>" [--dry-run]');
  process.exit(1);
}
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error('BLOB_READ_WRITE_TOKEN is not set (the store the app reads documents from).');
  process.exit(1);
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytes = readFileSync(file);
if (sha(bytes) !== APPROVED_SHA256) {
  console.error('This is not the approved Manatee County form (checksum differs). Nothing uploaded.');
  process.exit(1);
}

const existing = await get(STORAGE_KEY, { access: 'private', token }).catch(() => null);
if (existing && existing.statusCode === 200) {
  console.error(`Something is already stored at ${STORAGE_KEY}. Nothing uploaded — existing files are never overwritten.`);
  process.exit(1);
}

if (dryRun) {
  console.log(`Dry run: the approved form would be uploaded, private, to ${STORAGE_KEY}.`);
  process.exit(0);
}

await put(STORAGE_KEY, bytes, { access: 'private', contentType: 'application/pdf', addRandomSuffix: false, allowOverwrite: false, token });

const stored = await get(STORAGE_KEY, { access: 'private', token });
const chunks = [];
const reader = stored.stream.getReader();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(value);
}
if (sha(Buffer.concat(chunks)) !== APPROVED_SHA256) {
  console.error('Uploaded, but the stored copy does not match. Do not set the variable; investigate first.');
  process.exit(1);
}
console.log(`Uploaded and verified. Set MANATEE_DC_APPLICATION_TEMPLATE_STORAGE_KEY=${STORAGE_KEY}`);
