/**
 * Shared helpers for the in-app Google sign-in flow.
 *
 * Why this exists: the manual alternative is Google's OAuth Playground, which
 * involves pasting a client secret into a third-party page, hand-entering
 * scope URLs and copying a token out of a developer tool. That is the single
 * most error-prone step in setting this project up, and it has to be redone
 * by hand whenever the token is revoked. This replaces it with one button.
 */

import crypto from 'node:crypto';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Read-only throughout: the app can never send mail or change a calendar. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
];

export const STATE_COOKIE = 'rfc_oauth_state';
export const CALLBACK_PATH = '/api/auth/google/callback';

/**
 * The externally visible origin of this deployment.
 *
 * `request.url` is the internal URL behind the host's proxy, so it can carry
 * the wrong host and protocol. The forwarded headers are what the browser
 * actually asked for, and the redirect URI must match them exactly or Google
 * rejects the request.
 */
export function originFromHeaders(h: Headers): string | null {
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return null;
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function publicOrigin(request: Request): string {
  return originFromHeaders(request.headers) ?? new URL(request.url).origin;
}

export function redirectUri(request: Request): string {
  return `${publicOrigin(request)}${CALLBACK_PATH}`;
}

/**
 * The redirect URI to display on the Setup page, derived from the same
 * forwarded headers the live OAuth route uses. Sharing `originFromHeaders`
 * matters: if the page showed a URI the route does not actually send, whoever
 * copied it into Google Cloud Console would register the wrong one and the
 * sign-in would fail with the error this page is meant to prevent.
 */
export function redirectUriFromHeaders(h: Headers): string {
  return `${originFromHeaders(h) ?? 'http://localhost:3000'}${CALLBACK_PATH}`;
}

export function newState(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Constant-time comparison, so a mismatched state cannot be probed by timing.
 */
export function statesMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Minimal HTML shell matching the app's dark theme, for the result pages. */
export function page(title: string, bodyHtml: string): Response {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Rock Factory Central</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&family=Inter:wght@400;500&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
 :root{--cy:#3ddbf5;--vi:#b78cff;--bg:#070a13;--tx:#e8eefc;--sf:#97a3bd;--ok:#2fe0ad;--ur:#ff4d6d}
 *{box-sizing:border-box}
 body{margin:0;min-height:100vh;background:
   radial-gradient(900px 600px at 12% -5%,rgba(61,219,245,.13),transparent 60%),
   radial-gradient(800px 600px at 95% 8%,rgba(183,140,255,.11),transparent 58%),var(--bg);
   color:var(--tx);font-family:Inter,system-ui,sans-serif;padding:40px 20px;line-height:1.55}
 .card{max-width:680px;margin:0 auto;background:rgba(255,255,255,.028);
   border:1px solid rgba(255,255,255,.075);border-radius:14px;padding:30px 32px;
   backdrop-filter:blur(14px)}
 h1{font-family:'Chakra Petch',sans-serif;text-transform:uppercase;letter-spacing:.12em;
   font-size:23px;margin:0 0 6px}
 h2{font-family:'Chakra Petch',sans-serif;text-transform:uppercase;letter-spacing:.15em;
   font-size:12px;color:var(--cy);margin:26px 0 8px}
 p{color:var(--sf);font-size:14.5px}
 code,pre{font-family:'JetBrains Mono',monospace}
 pre{background:rgba(183,140,255,.1);border:1px solid rgba(183,140,255,.25);
   border-radius:9px;padding:14px;overflow-x:auto;font-size:12.5px;color:var(--vi);
   white-space:pre-wrap;word-break:break-all}
 .ok{color:var(--ok)} .bad{color:var(--ur)}
 ol{color:var(--sf);font-size:14.5px;padding-left:20px} li{margin-bottom:9px}
 a{color:var(--cy)}
 .warn{border-left:2px solid var(--ur);padding-left:14px;margin:20px 0}
</style></head><body><div class="card">${bodyHtml}</div></body></html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Never cache: these pages can contain a credential.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
