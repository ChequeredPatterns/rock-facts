/**
 * SETUP — written for someone who has never seen a terminal.
 *
 * Shows, in plain language, which systems are connected, which are not, and
 * exactly what is needed for each. The team can check this page themselves
 * instead of asking whether "the dashboard is broken".
 */

import { headers } from 'next/headers';
import { getDashboard } from '@/lib/data';
import { CALLBACK_PATH, redirectUriFromHeaders } from '@/lib/connectors/google-oauth';
import { LOGIN_CALLBACK_PATH, allowedViewers, gateMode } from '@/lib/auth/viewer';
import { SYSTEMS, isConfigured, missingEnv } from '@/lib/config';
import { SYSTEM_LABELS } from '@/lib/domain';
import { listCalendars, type CalendarSummary } from '@/lib/connectors/google';
import {
  listConnecteamSchedulers,
  type SchedulerSummary,
} from '@/lib/connectors/connecteam';

export const dynamic = 'force-dynamic';

/** Google sign-in state, which drives what the top of this page offers. */
type GoogleStage = 'no-credentials' | 'ready-to-connect' | 'connected';

function googleStage(): GoogleStage {
  const hasApp = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  if (!hasApp) return 'no-credentials';
  return process.env.GOOGLE_REFRESH_TOKEN ? 'connected' : 'ready-to-connect';
}

export default async function SetupPage() {
  const data = await getDashboard();
  const stage = googleStage();

  // Once connected, show the calendars so nobody has to hunt for IDs.
  let calendars: CalendarSummary[] | null = null;
  let calendarError: string | null = null;
  if (stage === 'connected') {
    try {
      calendars = await listCalendars();
    } catch (err) {
      calendarError = err instanceof Error ? err.message : 'Could not read calendars.';
    }
  }

  const chosen = (process.env.GOOGLE_EVENT_CALENDAR_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Connecteam's scheduler ID is not shown anywhere in Connecteam's own web
  // interface, so list the schedulers here as soon as the API key works —
  // otherwise the only way to find the ID is a terminal script.
  let schedulers: SchedulerSummary[] | null = null;
  let schedulerError: string | null = null;
  if (process.env.CONNECTEAM_API_KEY?.trim()) {
    try {
      schedulers = await listConnecteamSchedulers();
    } catch (err) {
      schedulerError = err instanceof Error ? err.message : 'Could not read schedulers.';
    }
  }

  const chosenScheduler = (process.env.CONNECTEAM_SCHEDULER_ID ?? '').trim();

  // The redirect URI must match what is registered in Google Cloud Console
  // character for character. Derive it from the same forwarded headers the
  // OAuth route itself uses, so what is shown here is exactly what gets sent —
  // and so it stays correct if the site is ever renamed.
  const redirectUri = redirectUriFromHeaders(await headers());
  // The staff sign-in uses a second, separate redirect URI on the same OAuth
  // client. Both must be registered or one of the two flows will fail.
  const loginRedirectUri = redirectUri.replace(CALLBACK_PATH, LOGIN_CALLBACK_PATH);

  const gate = gateMode();
  const viewers = allowedViewers();

  return (
    <>
      <div className="page-head">
        <h1>Setup</h1>
        <p>
          Which systems Rock Factory Central can currently see. Nothing here needs code — each
          connection is a key or sign-in pasted into the hosting dashboard.
        </p>
      </div>

      {/* --- Who can see this. Stated plainly, because "is the dashboard
          public?" is otherwise unanswerable without reading the code. --- */}
      <section className={gate === 'enforced' ? 'system connected' : 'system'}>
        <div className="system-head">
          <h2>Who can see this</h2>
          {gate === 'enforced' ? (
            <span className="chip ok">Sign-in required</span>
          ) : gate === 'locked' ? (
            <span className="chip urgent">Locked</span>
          ) : (
            <span className="chip soon">Open to anyone with the link</span>
          )}
        </div>

        {gate === 'open' ? (
          <p>
            No connector keys are set, so the dashboard holds nothing but sample data and
            anyone with the address can read it. <strong>The moment a real key is added
            the gate turns itself on</strong>, so live client data is never served to the
            open internet. Set <code>ALLOWED_EMAILS</code> before adding those keys, or the
            site will lock itself instead.
          </p>
        ) : gate === 'locked' ? (
          <p style={{ color: 'var(--urgent)' }}>
            Real data is configured but nobody can sign in, so the whole site is closed.
            Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and{' '}
            <code>ALLOWED_EMAILS</code> to reopen it.
          </p>
        ) : (
          <>
            <p>
              The dashboard is private. Only these Google accounts can open it, and a
              sign-in lasts fourteen days. Removing an address here locks that person out
              immediately, without waiting for their session to lapse.
            </p>
            <ul className="cal-list">
              {viewers.emails.map((e) => (
                <li key={e} className="cal">
                  <span className="cal-name">{e}</span>
                </li>
              ))}
              {viewers.domains.map((d) => (
                <li key={d} className="cal">
                  <span className="cal-name">Anyone at</span>
                  <code>@{d}</code>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* --- No Google app yet. Without this the page offered nothing at all
          for Google, so anyone looking for the sign-in found a blank space and
          no clue why. Show the two missing values and the exact redirect URI,
          built from the live site address so it cannot be mistyped. --- */}
      {stage === 'no-credentials' ? (
        <section className="system" style={{ borderColor: 'rgba(61,219,245,.4)' }}>
          <div className="system-head">
            <h2>Connect Google</h2>
            <span className="chip soon">Two values needed first</span>
          </div>
          <p>
            <strong>There is no sign-in button yet</strong> — it appears here as soon as this site
            knows which Google app to sign in to. That takes two values from the Google Cloud
            Console, added on Netlify under{' '}
            <strong>Site configuration → Environment variables</strong>:
          </p>
          <ul className="env-list">
            <li>
              <code>GOOGLE_CLIENT_ID</code>
            </li>
            <li>
              <code>GOOGLE_CLIENT_SECRET</code>
            </li>
          </ul>
          <p style={{ marginTop: 14 }}>
            When creating the OAuth client, add <strong>both</strong> of these under{' '}
            <strong>Authorised redirect URIs</strong> — copy them from here rather than typing
            them, as a mismatch is the most common reason the sign-in fails:
          </p>
          <ul className="cal-list">
            <li className="cal">
              <span className="cal-name">Connecting Google</span>
              <code>{redirectUri}</code>
            </li>
            <li className="cal">
              <span className="cal-name">Staff signing in</span>
              <code>{loginRedirectUri}</code>
            </li>
          </ul>
          <p style={{ marginTop: 14, color: 'var(--soon)' }}>
            After adding both values, trigger a deploy on Netlify. This page will then show a{' '}
            <strong>Sign in with Google</strong> button. Step-by-step instructions are in{' '}
            <code>SETUP.md</code>, Part 1.
          </p>
        </section>
      ) : null}

      {/* --- Google sign-in, the one step that needs the account owner --- */}
      {stage === 'ready-to-connect' ? (
        <section className="system" style={{ borderColor: 'rgba(61,219,245,.4)' }}>
          <div className="system-head">
            <h2>Connect Google</h2>
            <span className="chip accent">Ready</span>
          </div>
          <p>
            One click, one sign-in screen. Rock Factory Central asks for <strong>read-only</strong>{' '}
            access — it can never send email, change a calendar, or delete anything.
          </p>
          <p style={{ marginTop: 14 }}>
            <a className="btn" href="/api/auth/google">
              Sign in with Google →
            </a>
          </p>
        </section>
      ) : null}

      {stage === 'connected' && calendars ? (
        <section className="system connected">
          <div className="system-head">
            <h2>Your calendars</h2>
            <span className="chip ok">{calendars.length} found</span>
          </div>
          <p>
            Copy the IDs of the calendars holding client events into{' '}
            <code>GOOGLE_EVENT_CALENDAR_IDS</code>, separated by commas. Ticks show which are
            currently in use.
          </p>
          <ul className="cal-list">
            {calendars.map((c) => (
              <li key={c.id} className={chosen.includes(c.id) ? 'cal in-use' : 'cal'}>
                <span className="cal-name">
                  {chosen.includes(c.id) ? '✓ ' : ''}
                  {c.name}
                </span>
                <code>{c.id}</code>
              </li>
            ))}
          </ul>
          {chosen.length === 0 ? (
            <p style={{ color: 'var(--soon)' }}>
              No calendars selected yet, so the timeline will be empty. Pick at least one above.
            </p>
          ) : null}
        </section>
      ) : null}

      {calendarError ? (
        <div className="banner problem">
          <div>
            <strong>Could not read calendars</strong>
            <p>{calendarError}</p>
          </div>
        </div>
      ) : null}

      {/* --- Connecteam schedulers, so the ID never needs a terminal --- */}
      {schedulers && schedulers.length > 0 ? (
        <section className="system connected">
          <div className="system-head">
            <h2>Your Connecteam schedulers</h2>
            <span className="chip ok">{schedulers.length} found</span>
          </div>
          <p>
            Copy the ID of the scheduler holding your crew shifts into{' '}
            <code>CONNECTEAM_SCHEDULER_ID</code>. Just one, not a list. Connecteam does not show
            these IDs anywhere in its own screens, which is why they are here.
          </p>
          <ul className="cal-list">
            {schedulers.map((s) => (
              <li key={s.id} className={chosenScheduler === s.id ? 'cal in-use' : 'cal'}>
                <span className="cal-name">
                  {chosenScheduler === s.id ? '✓ ' : ''}
                  {s.name}
                </span>
                <code>{s.id}</code>
              </li>
            ))}
          </ul>
          {!chosenScheduler ? (
            <p style={{ color: 'var(--soon)' }}>
              No scheduler chosen yet, so crew shifts will not load. Pick one above.
            </p>
          ) : null}
        </section>
      ) : null}

      {schedulers && schedulers.length === 0 ? (
        <div className="banner problem">
          <div>
            <strong>Connecteam returned no schedulers</strong>
            <p>
              The API key works, but the account has no schedulers — or this plan does not expose
              them. Create a schedule in Connecteam, or check with their support that your plan
              includes Scheduler API access.
            </p>
          </div>
        </div>
      ) : null}

      {schedulerError ? (
        <div className="banner problem">
          <div>
            <strong>Could not read Connecteam schedulers</strong>
            <p>{schedulerError}</p>
          </div>
        </div>
      ) : null}

      {data.isSample ? (
        <div className="banner sample">
          <div>
            <strong>Running on sample data</strong>
            <p>
              No systems are connected yet, so the dashboard is showing invented examples. Connect
              one below and the sample data disappears automatically.
            </p>
          </div>
        </div>
      ) : null}

      {SYSTEMS.map((system) => {
        const configured = isConfigured(system.id);
        const health = data.health.find((h) => h.system === system.id);
        const missing = missingEnv(system.id);
        const live = configured && health?.ok && !data.isSample;

        return (
          <section className={live ? 'system connected' : 'system'} key={system.id}>
            <div className="system-head">
              <h2>{SYSTEM_LABELS[system.id]}</h2>
              {live ? (
                <span className="chip ok">Connected</span>
              ) : configured ? (
                <span className="chip urgent">Not responding</span>
              ) : (
                <span className="chip ghost">Not connected</span>
              )}
              {live && health?.records != null ? (
                <span className="chip ghost">{health.records} records</span>
              ) : null}
              {!system.specVerified ? (
                <span
                  className="chip soon"
                  title="This connector's request format could not be checked against the vendor's documentation during the build."
                >
                  Spec unverified
                </span>
              ) : null}
            </div>

            {configured && health?.error ? (
              <p style={{ color: 'var(--urgent)' }}>{health.error}</p>
            ) : (
              <p>{system.setupHint}</p>
            )}

            {missing.length > 0 ? (
              <ul className="env-list">
                {missing.map((key) => (
                  <li key={key}>
                    <code>{key}</code>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}

      <section style={{ marginTop: 34 }}>
        <h2>What your account owner needs to do</h2>
        <p className="prose">
          Only the Google step genuinely requires the account owner, and it is a single sign-in
          screen. The rest are keys that any admin can copy out of each product. The full
          step-by-step list, written for a non-technical reader, is in{' '}
          <code>SETUP.md</code> in this project.
        </p>
      </section>

      <section style={{ marginTop: 26 }}>
        <h2>One habit that makes this much more reliable</h2>
        <p className="prose">
          These five systems share no common ID, so Rock Factory Central matches jobs by client
          name, email and date. That works well, but it is guesswork at the edges. If the team puts
          the same job number — for example <strong>RF-1042</strong> — in the On Rent quote, the
          Streak box name and the calendar event title, matching becomes exact and nothing can be
          mismatched or missed.
        </p>
      </section>
    </>
  );
}
