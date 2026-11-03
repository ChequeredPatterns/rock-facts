import type { Metadata } from 'next';
import './globals.css';
import { Wordmark } from '@/components/Wordmark';
import { getDashboard } from '@/lib/data';
import { countBySeverity } from '@/lib/actions';
import { BUSINESS_TZ } from '@/lib/domain';

export const metadata: Metadata = {
  title: 'The Rock Factory Central',
  description:
    'One overview across Streak, On Rent Events, Google Calendar, Gmail and Connecteam.',
};

/** Always render fresh — this is an operational dashboard, not a brochure. */
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The action count is shown in the nav on every page, so the number of
  // things needing attention is visible wherever you are in the app.
  let urgentCount = 0;
  try {
    const data = await getDashboard();
    urgentCount = countBySeverity(data.actions).urgent;
  } catch {
    // Never let a nav badge take the whole page down.
    urgentCount = 0;
  }

  const today = new Intl.DateTimeFormat('en-NZ', {
    timeZone: BUSINESS_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <html lang="en-NZ">
      <body>
        <div className="shell">
          <header className="topbar">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
              <Wordmark size={19} />
              <div
                style={{
                  borderLeft: '3px solid var(--rule)',
                  paddingLeft: 14,
                  paddingBottom: 2,
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    fontSize: 19,
                    lineHeight: 1,
                    letterSpacing: '-0.01em',
                  }}
                >
                  Central
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 3 }}>
                  {today}
                </div>
              </div>
            </div>

            <nav className="nav">
              <a href="/">Timeline</a>
              <a href="/actions">
                Action needed
                {urgentCount > 0 ? <span className="count">({urgentCount})</span> : null}
              </a>
              <a href="/setup">Setup</a>
            </nav>
          </header>

          {children}
        </div>
      </body>
    </html>
  );
}
