/**
 * Starts the Google sign-in. Visiting /api/auth/google sends the user to
 * Google's consent screen and comes back to the callback route.
 */

import { NextResponse } from 'next/server';
import {
  GOOGLE_AUTH_URL,
  GOOGLE_SCOPES,
  STATE_COOKIE,
  newState,
  page,
  redirectUri,
} from '@/lib/connectors/google-oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const uri = redirectUri(request);

  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    return page(
      'Not configured yet',
      `<h1>Almost there</h1>
       <p>Google sign-in needs the two Cloud Console values first. Add these, redeploy,
          then come back to this page.</p>
       <pre>GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET</pre>
       <h2>Redirect URI to register</h2>
       <p>In Google Cloud Console, your OAuth client must list this exact address as an
          authorised redirect URI — copy it precisely, including <code>https</code>:</p>
       <pre>${uri}</pre>
       <p><a href="/setup">← Back to Setup</a></p>`,
    );
  }

  // CSRF protection: a random value echoed back by Google and checked against
  // an httpOnly cookie, so a forged callback cannot complete the flow.
  const state = newState();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: uri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    // offline + consent together are what actually produce a refresh token.
    // Without prompt=consent, Google returns none on repeat authorisations.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  const res = NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: uri.startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
