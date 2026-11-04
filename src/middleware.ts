/**
 * The gate. Runs before every page and API route.
 *
 * See `lib/auth/viewer.ts` for the rule. In short: the moment any real
 * credential is configured, a valid signed session is required to see
 * anything, and if no sign-in is possible at that moment the site locks
 * rather than serving live client data to whoever has the URL.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, gateMode, verifySession } from '@/lib/auth/viewer';

/**
 * Paths that must stay reachable without a session, or signing in would be
 * impossible. Kept deliberately short — everything else is behind the gate.
 */
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/login/callback', '/locked'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const mode = gateMode();

  if (mode === 'open') return NextResponse.next();

  if (mode === 'locked') {
    if (pathname === '/locked') return NextResponse.next();
    return NextResponse.redirect(new URL('/locked', request.url));
  }

  if (isPublic(pathname)) return NextResponse.next();

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  // Send them back where they were trying to go once they are in.
  const login = new URL('/login', request.url);
  const wanted = `${pathname}${search}`;
  if (wanted && wanted !== '/') login.searchParams.set('next', wanted);

  const res = NextResponse.redirect(login);
  // A stale or forged cookie is cleared so it cannot be retried endlessly.
  if (request.cookies.has(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  /**
   * Everything except Next's own build output and the favicon. Note that API
   * routes ARE matched: leaving them open would hand over the same data the
   * pages show, just in JSON.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
};
