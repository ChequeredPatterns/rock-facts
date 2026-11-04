/**
 * Completes the Google sign-in: exchanges the authorisation code for a
 * refresh token and shows it, with instructions for where to paste it.
 *
 * WHY IT SHOWS THE TOKEN RATHER THAN SAVING IT: on Netlify (and every similar
 * host) environment variables are set in the dashboard and are read-only to
 * running code, so a serverless function cannot persist the token itself.
 * Displaying it once, with no-store headers, is the standard pattern — and it
 * still removes every fiddly step of the manual OAuth Playground route.
 */

import { cookies } from 'next/headers';
import {
  GOOGLE_TOKEN_URL,
  STATE_COOKIE,
  page,
  redirectUri,
  statesMatch,
} from '@/lib/connectors/google-oauth';

export const dynamic = 'force-dynamic';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  if (error) {
    return page(
      'Sign-in cancelled',
      `<h1 class="bad">Sign-in did not complete</h1>
       <p>Google reported: <code>${escapeHtml(error)}</code></p>
       <p>If this said <code>access_denied</code>, the account simply declined the
          permission request. Nothing was changed. You can safely try again.</p>
       <p><a href="/api/auth/google">Try again</a> · <a href="/setup">Back to Setup</a></p>`,
    );
  }

  // Verify the CSRF state before touching the code.
  const expected = (await cookies()).get(STATE_COOKIE)?.value;
  if (!statesMatch(state ?? undefined, expected)) {
    return page(
      'Sign-in could not be verified',
      `<h1 class="bad">Could not verify this sign-in</h1>
       <p>The security check failed. This usually means the sign-in took longer than
          ten minutes, or it was started in a different browser from the one that
          finished it.</p>
       <p>Start again from the beginning and it should work.</p>
       <p><a href="/api/auth/google">Start again</a></p>`,
    );
  }

  if (!code) {
    return page(
      'Nothing to exchange',
      `<h1 class="bad">No authorisation code</h1>
       <p>Google did not send a code back. <a href="/api/auth/google">Start again</a>.</p>`,
    );
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri(request),
      grant_type: 'authorization_code',
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    refresh_token?: string;
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok) {
    const detail = escapeHtml(body.error_description ?? body.error ?? `HTTP ${res.status}`);
    const mismatch = /redirect_uri/i.test(detail);
    return page(
      'Exchange failed',
      `<h1 class="bad">Could not finish sign-in</h1>
       <p>Google said: <code>${detail}</code></p>
       ${
         mismatch
           ? `<div class="warn"><p>This is almost always the redirect URI. The address
              registered in Google Cloud Console must match this exactly — including
              <code>https</code> and with no trailing slash:</p>
              <pre>${redirectUri(request)}</pre></div>`
           : ''
       }
       <p><a href="/api/auth/google">Try again</a></p>`,
    );
  }

  if (!body.refresh_token) {
    return page(
      'No refresh token returned',
      `<h1 class="bad">Signed in, but no long-term token</h1>
       <p>Google completed the sign-in but returned no refresh token. That happens when
          this account has already granted access before, so Google assumes you still
          have the original token.</p>
       <h2>How to fix it</h2>
       <ol>
         <li>Go to <a href="https://myaccount.google.com/permissions" target="_blank"
             rel="noreferrer">your Google account permissions</a>.</li>
         <li>Find <strong>Rock Factory Central</strong> and remove its access.</li>
         <li><a href="/api/auth/google">Start the sign-in again</a>.</li>
       </ol>`,
    );
  }

  // Clear the state cookie — it has done its job.
  const result = page(
    'Connected',
    `<h1 class="ok">Google connected</h1>
     <p>Sign-in worked. One last step: this value has to be saved, because the app
        cannot write its own settings.</p>

     <h2>Your refresh token</h2>
     <pre>${escapeHtml(body.refresh_token)}</pre>

     <h2>What to do with it</h2>
     <ol>
       <li>Copy the value above.</li>
       <li>Go to your site on <a href="https://app.netlify.com" target="_blank"
           rel="noreferrer">Netlify</a> → <strong>Site configuration</strong> →
           <strong>Environment variables</strong>.</li>
       <li>Click <strong>Add a variable</strong> and name it
           <code>GOOGLE_REFRESH_TOKEN</code>.</li>
       <li>Go to <strong>Deploys</strong> → <strong>Trigger deploy</strong> →
           <strong>Deploy site</strong>.</li>
     </ol>

     <div class="warn">
       <p><strong>Treat this like a password.</strong> It grants read access to the
          calendars and mail of the account that just signed in. Don't paste it into a
          chat or an email. Close this page once it is saved — it is deliberately not
          cached, so reloading will not bring it back.</p>
     </div>

     <p>Once redeployed, the <a href="/setup">Setup page</a> will show Google as
        connected and list your calendars with their IDs.</p>`,
  );
  result.headers.append(
    'Set-Cookie',
    `${STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
  );
  return result;
}
