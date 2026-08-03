import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { resolveSigningToken, getDocumentBytesForSigning, SignatureServiceError } from '@/services/signatureService';
import { DocumentServiceError } from '@/services/documentService';

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). Streams
 * the actual PDF bytes for the signer's in-page review — mirrors the
 * authenticated `GET /api/cases/[caseId]/documents/[documentId]/download`
 * route's own pattern (bytes streamed directly in the response, never a
 * raw storage URL constructed for or sent to the browser), except this
 * one is `inline` (rendered in-page) rather than `attachment` (a forced
 * download), since the signer needs to review the document before
 * signing, not save a copy.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const dataAdapterMode = getDataAdapterMode();

  let signatureRequest;
  try {
    signatureRequest = await resolveSigningToken(token, dataAdapterMode);
  } catch (error) {
    if (error instanceof SignatureServiceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  try {
    const { buffer, contentType, fileName } = await getDocumentBytesForSigning(signatureRequest, dataAdapterMode);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { 'Content-Type': contentType, 'Content-Disposition': `inline; filename="${fileName}"` },
    });
  } catch (error) {
    if (error instanceof DocumentServiceError) {
      return NextResponse.json({ error: 'This document is not available for review.' }, { status: 404 });
    }
    throw error;
  }
}
