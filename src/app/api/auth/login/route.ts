/**
 * Start a viewer sign-in: bounce to Google asking only who they are.
 *
 * Scopes here are identity only — no calendar, no mail. The dashboard's own
 * read access comes from the separate one-off connection in
 * /api/auth/google, and signing in to view must not quietly ask each member
 * of staff for access to their own mailbox.
 */

import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { GOOGLE_AUTH_URL, publicOrigin } from '@/lib/connectors/google-oauth';
import { LOGIN_CALLBACK_PATH, LOGIN_STATE_COOKIE, canSignIn } from '@/lib/auth/viewer';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!canSignIn()) {
    return NextResponse.redirect(new URL('/locked', publicOrigin(request)));
  }

  const url = new URL(request.url);
  const next = url.searchParams.get('next') ?? '/';

  // Bind the state cookie to where we are going, so the callback cannot be
  // talked into redirecting somewhere else. Only same-site paths are kept.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const state = crypto.randomBytes(24).toString('base64url');

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: `${publicOrigin(request)}${LOGIN_CALLBACK_PATH}`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Always show the chooser: shared office machines are common, and silently
    // reusing whichever account Google last saw is how the wrong person ends
    // up looking at the dashboard.
    prompt: 'select_account',
  });

  const res = NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  res.cookies.set(LOGIN_STATE_COOKIE, `${state}|${safeNext}`, {
    httpOnly: true,
    secure: new URL(publicOrigin(request)).protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
