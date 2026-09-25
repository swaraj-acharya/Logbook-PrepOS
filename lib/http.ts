import { NextResponse } from 'next/server';
import { StoreError } from './storage/types';

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export function errorResponse(e: unknown) {
  if (e instanceof StoreError) return json({ error: e.message }, e.status);
  console.error(e);
  return json({ error: 'Server error' }, 500);
}
