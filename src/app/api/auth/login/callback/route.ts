/**
 * Finish a viewer sign-in.
 *
 * Exchanges the code, establishes which Google account it belongs to, checks
 * that address against the allowlist, and only then issues a session.
 */

import { NextResponse } from 'next/server';
import { GOOGLE_TOKEN_URL, publicOrigin, page } from '@/lib/connectors/google-oauth';
import {
  LOGIN_CALLBACK_PATH,
  LOGIN_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  canSignIn,
  isAllowedViewer,
  signSession,
} from '@/lib/auth/viewer';

export const dynamic = 'force-dynamic';

function denied(title: string, body: string): Response {
  return page(title, body);
}

/** Constant-time compare, so the state cannot be probed a character at a time. */
function sameState(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function GET(request: Request) {
  const origin = publicOrigin(request);
  if (!canSignIn()) return NextResponse.redirect(new URL('/locked', origin));

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return denied(
      'Sign-in cancelled',
      `<h1>Sign-in cancelled</h1><p>Google reported: <code>${oauthError.replace(/[<>&]/g, '')}</code></p>
       <p><a href="/login">Try again</a></p>`,
    );
  }

  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${LOGIN_STATE_COOKIE}=`))
    ?.slice(LOGIN_STATE_COOKIE.length + 1);

  const [expectedState, next = '/'] = decodeURIComponent(cookie ?? '').split('|');

  if (!code || !state || !expectedState || !sameState(state, expectedState)) {
    return denied(
      'Sign-in could not be completed',
      `<h1>Sign-in could not be completed</h1>
       <p>The request did not match the one that started it. This usually means the
       sign-in was left open too long, or cookies are blocked.</p>
       <p><a href="/login">Start again</a></p>`,
    );
  }

  // --- Exchange the code for an identity -----------------------------------
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
      redirect_uri: `${origin}${LOGIN_CALLBACK_PATH}`,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const detail = (await tokenRes.text().catch(() => '')).slice(0, 300);
    const hint = detail.includes('redirect_uri_mismatch')
      ? `<div class="warn"><p>Google rejected the redirect URI. Add this exact address to
         your OAuth client's <strong>Authorised redirect URIs</strong>:</p>
         <pre>${origin}${LOGIN_CALLBACK_PATH}</pre></div>`
      : '';
    return denied(
      'Sign-in failed',
      `<h1>Sign-in failed</h1><p>Google did not accept the sign-in.</p>${hint}
       <pre>${detail.replace(/[<>&]/g, '')}</pre><p><a href="/login">Try again</a></p>`,
    );
  }

  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) {
    return denied('Sign-in failed', `<h1>Sign-in failed</h1><p>No access token was returned.</p>`);
  }

  const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!infoRes.ok) {
    return denied('Sign-in failed', `<h1>Sign-in failed</h1><p>Could not read the account.</p>`);
  }
  const info = (await infoRes.json()) as { email?: string; email_verified?: boolean };

  // An unverified address proves nothing about who owns it.
  if (!info.email || info.email_verified === false) {
    return denied(
      'Sign-in failed',
      `<h1>Sign-in failed</h1><p>That Google account has no verified email address.</p>`,
    );
  }

  if (!isAllowedViewer(info.email)) {
    const safe = info.email.replace(/[<>&]/g, '');
    return denied(
      'Not on the list',
      `<h1>No access for this account</h1>
       <p>You signed in as <code>${safe}</code>, which is not permitted to view
       Rock Factory Central.</p>
       <p>If that is the wrong account, <a href="/api/auth/login">sign in with a
       different one</a>. Otherwise ask whoever looks after the dashboard to add
       your address.</p>`,
    );
  }

  const session = await signSession(info.email);
  if (!session) {
    return denied('Sign-in failed', `<h1>Sign-in failed</h1><p>No signing key is configured.</p>`);
  }

  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const res = NextResponse.redirect(new URL(safeNext, origin));
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: new URL(origin).protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  res.cookies.delete(LOGIN_STATE_COOKIE);
  return res;
}
