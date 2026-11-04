/**
 * The sign-in screen. Deliberately says nothing about the business: it is the
 * one page the open internet can see.
 */

import { canSignIn } from '@/lib/auth/viewer';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  const href = safeNext ? `/api/auth/login?next=${encodeURIComponent(safeNext)}` : '/api/auth/login';

  return (
    <div style={{ maxWidth: 440, margin: '12vh auto 0', textAlign: 'center' }}>
      <div className="page-head" style={{ textAlign: 'center' }}>
        <h1>Sign in</h1>
        <p>Rock Factory Central is private. Sign in with your work Google account to continue.</p>
      </div>

      {canSignIn() ? (
        <p style={{ marginTop: 26 }}>
          <a className="btn" href={href}>
            Sign in with Google →
          </a>
        </p>
      ) : (
        <p style={{ color: 'var(--soon)' }}>
          Sign-in is not configured yet, so nobody can be let in.
        </p>
      )}

      <p style={{ marginTop: 30, fontSize: 13, color: 'var(--soon)' }}>
        Only addresses approved in advance can view the dashboard. Signing in shares your
        name and email address with this site, and nothing else — it asks for no access to
        your mail or calendar.
      </p>
    </div>
  );
}
