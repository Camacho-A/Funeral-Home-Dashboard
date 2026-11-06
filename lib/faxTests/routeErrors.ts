import { NextResponse } from 'next/server';
import { FaxTestError } from '@/services/faxTests/faxTestService';

/** Fax test transmissions (2026-11): a refusal's own message and status; anything else is logged and generic. */
export function faxTestErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof FaxTestError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(fallback, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
