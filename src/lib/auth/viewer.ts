/**
 * Who is allowed to LOOK at the dashboard.
 *
 * This is a different question from the Google connection in
 * `connectors/google-oauth.ts`. That one is about the single account whose
 * calendar and mail the dashboard reads, and it happens once at setup. This
 * one is about every person who opens the site, every time.
 *
 * Without it the dashboard is readable by anyone who has the URL. Netlify
 * addresses are not secret — every certificate issued for one is published in
 * the public Certificate Transparency logs, which are continuously scraped —
 * so "nobody knows the address" is not a control.
 *
 * Everything here uses Web Crypto rather than `node:crypto`, because the
 * middleware that enforces it runs on the Edge runtime where `node:crypto` is
 * unavailable.
 */

export const SESSION_COOKIE = 'rfc_viewer';
export const LOGIN_STATE_COOKIE = 'rfc_login_state';
export const LOGIN_CALLBACK_PATH = '/api/auth/login/callback';

/** How long a sign-in lasts before it has to be done again. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

/**
 * The key used to sign session cookies.
 *
 * Falls back to the Google client secret so there is one less value to set up.
 * That is sound — it is a high-entropy secret already present and already
 * server-side — and it means rotating the Google secret also invalidates every
 * existing session, which is the behaviour you want from a rotation anyway.
 */
function sessionSecret(): string | null {
  return (
    process.env.SESSION_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    // Last resort for a password-only deployment with no Google app yet.
    // Deriving the signing key from the password means changing the password
    // also signs everyone out, which is the behaviour you want. It is the
    // weakest of the three though — a short password makes a weak signing key
    // — so `SESSION_SECRET` is worth setting. The Setup page says so.
    (process.env.SITE_PASSWORD?.trim() ? `pw:${process.env.SITE_PASSWORD.trim()}` : null)
  );
}

/** The shared password, if one is configured. */
export function sitePassword(): string | null {
  const p = process.env.SITE_PASSWORD?.trim();
  return p ? p : null;
}

export function passwordLoginEnabled(): boolean {
  return sitePassword() !== null;
}

/** True when the signing key is only as strong as the password itself. */
export function sessionSecretIsWeak(): boolean {
  return (
    !process.env.SESSION_SECRET?.trim() &&
    !process.env.GOOGLE_CLIENT_SECRET?.trim() &&
    passwordLoginEnabled()
  );
}

/**
 * Check a submitted password.
 *
 * Compared in constant time so the answer cannot be built up a character at a
 * time from response timing.
 */
export function passwordMatches(submitted: string | undefined): boolean {
  const expected = sitePassword();
  if (!expected || typeof submitted !== 'string') return false;
  return constantTimeEqual(submitted, expected);
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

/** Comparison that does not leak, through timing, how much of a tag matched. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** How someone proved they were allowed in. */
export type ViewerVia = 'google' | 'password';

export interface ViewerSession {
  /** The Google address, or 'password' for a shared-password sign-in. */
  email: string;
  via: ViewerVia;
  exp: number;
}

export async function signSession(
  email: string,
  via: ViewerVia = 'google',
  now = Date.now(),
): Promise<string | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const payload: ViewerSession = {
    email: email.toLowerCase(),
    via,
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  };
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

/**
 * Verify a session cookie. Returns null for anything not genuinely signed by
 * this deployment and still in date — a tampered payload, a cookie signed with
 * an older secret, or one that has simply expired.
 */
export async function verifySession(
  token: string | undefined,
  now = Date.now(),
): Promise<ViewerSession | null> {
  const secret = sessionSecret();
  if (!secret || !token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const tag = token.slice(dot + 1);

  if (!constantTimeEqual(tag, await hmac(secret, body))) return null;

  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as ViewerSession;
    if (typeof parsed?.email !== 'string' || typeof parsed?.exp !== 'number') return null;
    if (parsed.exp * 1000 <= now) return null;

    // Each method is re-checked on every request, not just at sign-in.
    if (parsed.via === 'password') {
      // Turning the password off must evict everyone who used it, rather than
      // leaving valid sessions behind for up to a fortnight.
      return passwordLoginEnabled() ? parsed : null;
    }
    // Removing someone from the allowlist takes effect on their next page
    // load, rather than whenever their cookie happens to lapse.
    return isAllowedViewer(parsed.email) ? parsed : null;
  } catch {
    return null;
  }
}

/** Addresses permitted to view, as configured. */
export function allowedViewers(): { emails: string[]; domains: string[] } {
  const emails = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const domains = (process.env.ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return { emails, domains };
}

export function isAllowedViewer(email: string | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  // An address must have exactly one @ and something on each side, or the
  // domain check below could be fooled by a crafted local part.
  const parts = e.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;

  const { emails, domains } = allowedViewers();
  // Fail closed: configuring no allowlist at all admits nobody, rather than
  // silently admitting everyone with a Google account.
  if (emails.length === 0 && domains.length === 0) return false;

  if (emails.includes(e)) return true;
  return domains.includes(parts[1]);
}

/** True once there is a Google app to sign in against and someone to admit. */
export function canSignInWithGoogle(): boolean {
  const { emails, domains } = allowedViewers();
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      sessionSecret() &&
      (emails.length > 0 || domains.length > 0),
  );
}

/** Any working way in at all. */
export function canSignIn(): boolean {
  if (passwordLoginEnabled() && sessionSecret()) return true;
  return canSignInWithGoogle();
}

/**
 * Whether any real business data could be on screen.
 *
 * Deliberately a direct read of the credential variables rather than a call
 * into `config.ts`: this runs in middleware on every request, and the question
 * is only ever "is any key present".
 */
export function holdsRealData(): boolean {
  return [
    'GOOGLE_REFRESH_TOKEN',
    'STREAK_API_KEY',
    'CONNECTEAM_API_KEY',
    'ONRENT_API_KEY',
  ].some((k) => Boolean(process.env[k]?.trim()));
}

export type GateMode =
  /** Nothing but sample data exists, so the site can be browsed freely. */
  | 'open'
  /** Real data is present and sign-in works: require it. */
  | 'enforced'
  /** Real data is present but nobody could sign in. Show nothing. */
  | 'locked';

/**
 * The rule the middleware applies.
 *
 * The ordering is the point: the gate turns itself on as soon as a credential
 * appears, so there is no window in which live client data is served to the
 * open internet because the login had not been configured yet. If the login
 * cannot work at that moment, the site locks rather than opens — the failure
 * mode is "staff cannot get in", which is recoverable and obvious, instead of
 * "everyone can get in", which is neither.
 */
export function gateMode(): GateMode {
  if (!holdsRealData()) return 'open';
  return canSignIn() ? 'enforced' : 'locked';
}
