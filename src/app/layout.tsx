import type { Metadata } from 'next';
import './globals.css';
import { Wordmark } from '@/components/Wordmark';
import { getDashboard } from '@/lib/data';
import { countBySeverity } from '@/lib/actions';
import { BUSINESS_TZ } from '@/lib/domain';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, gateMode, verifySession } from '@/lib/auth/viewer';

export const metadata: Metadata = {
  title: 'The Rock Factory Central',
  description:
    'One overview across Streak, On Rent Events, Google Calendar, Gmail and Connecteam.',
};

/** Always render fresh — this is an operational dashboard, not a brochure. */
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Who, if anyone, is signed in. The nav is built from this: offering links
  // to pages the visitor cannot open just bounces them back to the sign-in,
  // and without a way out there is no signing off a shared office machine.
  const viewer = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const signedIn = gateMode() !== 'enforced' || viewer !== null;

  // The action count is shown in the nav on every page, so the number of
  // things needing attention is visible wherever you are in the app.
  let urgentCount = 0;
  if (signedIn) {
    try {
      const data = await getDashboard();
      urgentCount = countBySeverity(data.actions).urgent;
    } catch {
      // Never let a nav badge take the whole page down.
      urgentCount = 0;
    }
  }

  const today = new Intl.DateTimeFormat('en-NZ', {
    timeZone: BUSINESS_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <html lang="en-NZ">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Anton&family=Chakra+Petch:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#04060d" />
      </head>
      <body>
        <div className="shell">
          <header className="topbar">
            <div className="brand">
              <Wordmark size={17} />
              <div className="brand-divider" />
              <div>
                <div className="brand-sub">Central</div>
                <div className="brand-date">{today}</div>
              </div>
            </div>

            {signedIn ? (
              <nav className="nav">
                <a href="/">Timeline</a>
                <a href="/actions">
                  Action
                  {urgentCount > 0 ? <span className="count">{urgentCount}</span> : null}
                </a>
                <a href="/setup">Setup</a>
                {viewer ? (
                  <a href="/api/auth/logout" title={`Signed in as ${viewer.email}`}>
                    Sign out
                  </a>
                ) : null}
              </nav>
            ) : null}
          </header>

          {children}
        </div>
      </body>
    </html>
  );
}
