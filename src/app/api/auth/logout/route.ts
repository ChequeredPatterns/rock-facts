/**
 * Sign out: drop the session cookie and go back to the sign-in screen.
 *
 * Matters on shared office machines, where the alternative is a browser left
 * logged in to the whole pipeline.
 */

import { NextResponse } from 'next/server';
import { publicOrigin } from '@/lib/connectors/google-oauth';
import { SESSION_COOKIE } from '@/lib/auth/viewer';

export const dynamic = 'force-dynamic';

function signOut(request: Request) {
  const res = NextResponse.redirect(new URL('/login', publicOrigin(request)));
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}

export const GET = signOut;
export const POST = signOut;
