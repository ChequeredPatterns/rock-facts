/**
 * The sign-in screen. Deliberately says nothing about the business: it is the
 * one page the open internet can see.
 */

import { canSignIn, canSignInWithGoogle, passwordLoginEnabled } from '@/lib/auth/viewer';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; mins?: string }>;
}) {
  const { next, error, mins } = await searchParams;
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  const googleHref = safeNext
    ? `/api/auth/login?next=${encodeURIComponent(safeNext)}`
    : '/api/auth/login';

  const message =
    error === 'wrong'
      ? 'That password is not right.'
      : error === 'locked'
        ? `Too many attempts. Try again in ${mins ?? 'a few'} minute${mins === '1' ? '' : 's'}.`
        : error === 'unconfigured'
          ? 'Sign-in is not fully configured on this site.'
          : null;

  return (
    <div style={{ maxWidth: 440, margin: '12vh auto 0', textAlign: 'center' }}>
      <div className="page-head" style={{ textAlign: 'center' }}>
        <h1>Sign in</h1>
        <p>Rock Factory Central is private.</p>
      </div>

      {message ? (
        <p style={{ color: 'var(--urgent)', marginTop: 18 }} role="alert">
          {message}
        </p>
      ) : null}

      {passwordLoginEnabled() ? (
        <form method="POST" action="/api/auth/password" style={{ marginTop: 22 }}>
          {safeNext ? <input type="hidden" name="next" value={safeNext} /> : null}
          <input
            className="pw-input"
            type="password"
            name="password"
            // The password is case-sensitive, so stop phones helpfully
            // capitalising or autocorrecting the first character.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="current-password"
            aria-label="Password"
            placeholder="Password"
            autoFocus
            required
          />
          <p style={{ marginTop: 16 }}>
            <button className="btn" type="submit">
              Enter →
            </button>
          </p>
        </form>
      ) : null}

      {canSignInWithGoogle() ? (
        <p style={{ marginTop: passwordLoginEnabled() ? 26 : 22 }}>
          <a className="btn" href={googleHref}>
            Sign in with Google →
          </a>
        </p>
      ) : null}

      {!canSignIn() ? (
        <p style={{ color: 'var(--soon)' }}>
          Sign-in is not configured yet, so nobody can be let in.
        </p>
      ) : null}
    </div>
  );
}
