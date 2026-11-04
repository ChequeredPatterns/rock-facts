/**
 * Shown when real credentials are configured but no sign-in is possible.
 *
 * This is the safe failure. Rather than serve live client data to anyone with
 * the address, the site closes and explains what is missing. It names only
 * variable names, never values.
 */

import { allowedViewers, holdsRealData } from '@/lib/auth/viewer';
import { redirectUriFromHeaders } from '@/lib/connectors/google-oauth';
import { LOGIN_CALLBACK_PATH } from '@/lib/auth/viewer';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function LockedPage() {
  const h = await headers();
  const loginUri = redirectUriFromHeaders(h).replace('/api/auth/google/callback', LOGIN_CALLBACK_PATH);

  const { emails, domains } = allowedViewers();
  // Either route in is enough, so only report what the simpler one needs
  // unless the Google route is already half-configured.
  const googleStarted = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() || emails.length > 0 || domains.length > 0,
  );
  const missing: string[] = [];
  if (!googleStarted) {
    missing.push('SITE_PASSWORD');
  } else {
    if (!process.env.GOOGLE_CLIENT_ID?.trim()) missing.push('GOOGLE_CLIENT_ID');
    if (!process.env.GOOGLE_CLIENT_SECRET?.trim()) missing.push('GOOGLE_CLIENT_SECRET');
    if (emails.length === 0 && domains.length === 0) missing.push('ALLOWED_EMAILS');
  }

  return (
    <div style={{ maxWidth: 620, margin: '10vh auto 0' }}>
      <div className="page-head">
        <h1>Locked</h1>
        <p>
          This dashboard is holding live business data but has no way to check who you are,
          so it is showing nothing at all.
        </p>
      </div>

      {holdsRealData() ? (
        <section className="system">
          <div className="system-head">
            <h2>To open it again</h2>
            <span className="chip soon">{missing.length} missing</span>
          </div>
          <p>Add these on Netlify under Site configuration → Environment variables:</p>
          <ul className="env-list">
            {missing.map((k) => (
              <li key={k}>
                <code>{k}</code>
              </li>
            ))}
          </ul>
          {missing.includes('SITE_PASSWORD') ? (
            <p style={{ marginTop: 14 }}>
              <code>SITE_PASSWORD</code> is a single shared password everyone types to get
              in. Alternatively, set <code>ALLOWED_EMAILS</code> together with the Google
              credentials to use a per-person Google sign-in instead.
            </p>
          ) : (
            <>
              <p style={{ marginTop: 14 }}>
                <code>ALLOWED_EMAILS</code> is a comma-separated list of the Google
                addresses permitted to view this. <code>ALLOWED_EMAIL_DOMAINS</code> may be
                used instead to admit a whole work domain.
              </p>
              <p style={{ marginTop: 14 }}>
                The OAuth client also needs this address among its{' '}
                <strong>Authorised redirect URIs</strong>, alongside the one used to connect
                Google:
              </p>
              <p>
                <code>{loginUri}</code>
              </p>
            </>
          )}
          <p style={{ marginTop: 14, color: 'var(--soon)' }}>
            Then trigger a deploy. If you would rather take the dashboard offline instead,
            remove the connector keys and it reverts to sample data.
          </p>
        </section>
      ) : null}
    </div>
  );
}
