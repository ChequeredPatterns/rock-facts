/**
 * SETUP — written for someone who has never seen a terminal.
 *
 * Shows, in plain language, which systems are connected, which are not, and
 * exactly what is needed for each. The team can check this page themselves
 * instead of asking whether "the dashboard is broken".
 */

import { getDashboard } from '@/lib/data';
import { SYSTEMS, isConfigured, missingEnv } from '@/lib/config';
import { SYSTEM_LABELS } from '@/lib/domain';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const data = await getDashboard();

  return (
    <>
      <div className="page-head">
        <h1>Setup</h1>
        <p>
          Which systems Rock Factory Central can currently see. Nothing here needs code — each
          connection is a key or sign-in pasted into the hosting dashboard.
        </p>
      </div>

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
        <p style={{ color: 'var(--ink-soft)', maxWidth: '64ch' }}>
          Only the Google step genuinely requires the account owner, and it is a single sign-in
          screen. The rest are keys that any admin can copy out of each product. The full
          step-by-step list, written for a non-technical reader, is in{' '}
          <code>SETUP.md</code> in this project.
        </p>
      </section>

      <section style={{ marginTop: 26 }}>
        <h2>One habit that makes this much more reliable</h2>
        <p style={{ color: 'var(--ink-soft)', maxWidth: '64ch' }}>
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
