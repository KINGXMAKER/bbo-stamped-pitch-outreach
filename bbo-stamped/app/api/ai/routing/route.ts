import { NextResponse } from 'next/server';
import { describeRouting } from '@/lib/ai/models';

export const runtime = 'nodejs';

/**
 * Read-only view of the live provider wiring for the debug panel.
 *
 * Returns provider names, model ids and whether a key is present — never the
 * key itself, and never any part of it.
 */
export async function GET() {
  return NextResponse.json({ routing: describeRouting() });
}
