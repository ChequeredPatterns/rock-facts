/**
 * Shared-password sign-in.
 *
 * A short password is quick to guess: a four-digit one has only ten thousand
 * possibilities, which an unthrottled endpoint would give up in well under a
 * minute. So every wrong answer is counted, and an address that keeps getting
 * it wrong is made to wait.
 *
 * Honest limitation: this runs on serverless functions, so the counters live
 * in the memory of whichever instance happened to serve the request and are
 * lost when it is recycled. That makes this a real obstacle to a casual
 * attempt rather than a guarantee against a determined, distributed one. The
 * durable fix is a longer password, which costs nothing.
 */

import { NextResponse } from 'next/server';
import { publicOrigin } from '@/lib/connectors/google-oauth';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  passwordLoginEnabled,
  passwordMatches,
  signSession,
} from '@/lib/auth/viewer';

export const dynamic = 'force-dynamic';

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

interface Attempts {
  count: number;
  first: number;
  lockedUntil?: number;
}
const attempts = new Map<string, Attempts>();

function clientKey(request: Request): string {
  const h = request.headers;
  // Netlify sets x-nf-client-connection-ip; x-forwarded-for is the general
  // case. Take the first entry, which is the original client.
  const ip =
    h.get('x-nf-client-connection-ip') ??
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  return ip;
}

/** Returns milliseconds left to wait, or 0 if an attempt is allowed. */
function lockedFor(key: string, now: number): number {
  const rec = attempts.get(key);
  if (!rec) return 0;
  if (rec.lockedUntil && rec.lockedUntil > now) return rec.lockedUntil - now;
  if (now - rec.first > WINDOW_MS) {
    attempts.delete(key);
    return 0;
  }
  return 0;
}

function recordFailure(key: string, now: number): void {
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return;
  }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCKOUT_MS;
    rec.count = 0;
    rec.first = now;
  }
}

function backToLogin(request: Request, params: Record<string, string>) {
  const url = new URL('/login', publicOrigin(request));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // 303 so the browser follows with GET rather than re-posting the password.
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  if (!passwordLoginEnabled()) {
    return NextResponse.redirect(new URL('/locked', publicOrigin(request)), 303);
  }

  const now = Date.now();
  const key = clientKey(request);

  const wait = lockedFor(key, now);
  if (wait > 0) {
    return backToLogin(request, { error: 'locked', mins: String(Math.ceil(wait / 60000)) });
  }

  const form = await request.formData().catch(() => null);
  const submitted = form?.get('password');
  const next = String(form?.get('next') ?? '/');

  if (!passwordMatches(typeof submitted === 'string' ? submitted : undefined)) {
    recordFailure(key, now);
    return backToLogin(request, { error: 'wrong' });
  }

  const session = await signSession('password', 'password');
  if (!session) return backToLogin(request, { error: 'unconfigured' });

  attempts.delete(key);

  const origin = publicOrigin(request);
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const res = NextResponse.redirect(new URL(safeNext, origin), 303);
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: new URL(origin).protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
