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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap"
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

            <nav className="nav">
              <a href="/">Timeline</a>
              <a href="/actions">
                Action
                {urgentCount > 0 ? <span className="count">{urgentCount}</span> : null}
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
