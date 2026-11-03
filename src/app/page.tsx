/**
 * TIMELINE — the main screen.
 *
 * Date-first, because the question asked most often in an events business is
 * "what's happening this week, and is it covered?". Every job is grouped
 * under its event day, with the information needed to answer that question
 * without opening another tab.
 */

import { JobRow } from '@/components/JobRow';
import { getDashboard } from '@/lib/data';
import { countBySeverity } from '@/lib/actions';
import {
  BUSINESS_TZ,
  businessDayKey,
  COMMITTED_STATUSES,
  crewShortfall,
  formatMoney,
  type Job,
} from '@/lib/domain';

export const dynamic = 'force-dynamic';

function groupByDay(jobs: Job[]): { key: string; jobs: Job[] }[] {
  const map = new Map<string, Job[]>();
  for (const job of jobs) {
    if (!job.eventStart) continue;
    const key = businessDayKey(job.eventStart);
    const list = map.get(key);
    if (list) list.push(job);
    else map.set(key, [job]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, dayJobs]) => ({
      key,
      jobs: dayJobs.sort((a, b) => (a.eventStart ?? '').localeCompare(b.eventStart ?? '')),
    }));
}

function dayLabels(key: string, todayKey: string) {
  // Parse as local noon to avoid any timezone edge rolling the date over.
  const d = new Date(`${key}T12:00:00`);
  const dow = new Intl.DateTimeFormat('en-NZ', { weekday: 'long' }).format(d);
  const date = new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric',
    month: 'short',
  }).format(d);

  const diff = Math.round(
    (new Date(`${key}T12:00:00`).getTime() - new Date(`${todayKey}T12:00:00`).getTime()) /
      86_400_000,
  );
  let relative = '';
  if (diff === 0) relative = 'Today';
  else if (diff === 1) relative = 'Tomorrow';
  else if (diff > 1) relative = `In ${diff} days`;
  else if (diff === -1) relative = 'Yesterday';
  else relative = `${Math.abs(diff)} days ago`;

  return { dow, date, relative, isToday: diff === 0, isPast: diff < 0 };
}

export default async function TimelinePage() {
  const data = await getDashboard();
  const now = new Date(data.fetchedAt);
  const todayKey = businessDayKey(now.toISOString());

  // The timeline shows upcoming work. Past jobs stay available on the
  // action list if anything is outstanding, but they do not clutter the
  // forward view.
  const upcoming = data.jobs.filter(
    (j) => j.eventStart && businessDayKey(j.eventStart) >= todayKey,
  );
  const undated = data.jobs.filter((j) => !j.eventStart);
  const days = groupByDay(upcoming);

  const severity = countBySeverity(data.actions);
  const next14 = upcoming.filter((j) => {
    const diff =
      (new Date(j.eventStart!).getTime() - now.getTime()) / 86_400_000;
    return diff <= 14;
  });
  const committedValue = upcoming
    .filter((j) => COMMITTED_STATUSES.includes(j.status))
    .reduce((sum, j) => sum + (j.quoteTotal ?? 0), 0);
  const understaffed = upcoming.filter(
    (j) => COMMITTED_STATUSES.includes(j.status) && (crewShortfall(j) > 0 || j.crew.length === 0),
  ).length;

  const brokenSystems = data.health.filter((h) => h.configured && !h.ok);

  return (
    <>
      <div className="page-head">
        <h1>Timeline</h1>
        <p>
          Everything coming up, pulled together from Streak, On Rent Events, Google Calendar and
          Connecteam. Times shown in {BUSINESS_TZ.replace('_', ' ')}.
        </p>
      </div>

      {data.isSample ? (
        <div className="banner sample">
          <div>
            <strong>Sample data</strong>
            <p>
              Nothing is connected yet, so these are invented jobs to show how the dashboard works.
              None of these figures are real. Go to <a className="plain" href="/setup">Setup</a> to
              connect your real systems.
            </p>
          </div>
        </div>
      ) : null}

      {brokenSystems.length > 0 ? (
        <div className="banner problem">
          <div>
            <strong>{brokenSystems.length} system(s) not responding</strong>
            <p>
              {brokenSystems.map((h) => h.system).join(', ')} could not be reached, so some
              information below may be incomplete. See{' '}
              <a className="plain" href="/setup">
                Setup
              </a>{' '}
              for details.
            </p>
          </div>
        </div>
      ) : null}

      <div className="stats">
        <div className="stat">
          <div className="label">Next 14 days</div>
          <div className="value">{next14.length}</div>
        </div>
        <div className="stat">
          <div className="label">Committed value</div>
          <div className="value">{formatMoney(committedValue)}</div>
        </div>
        <div className="stat">
          <div className="label">Needs crew</div>
          <div className={understaffed > 0 ? 'value urgent' : 'value'}>{understaffed}</div>
        </div>
        <div className="stat">
          <div className="label">Urgent actions</div>
          <div className={severity.urgent > 0 ? 'value urgent' : 'value'}>{severity.urgent}</div>
        </div>
      </div>

      {days.length === 0 ? (
        <div className="empty">
          <p>No upcoming events found in the connected systems.</p>
        </div>
      ) : (
        days.map(({ key, jobs }) => {
          const { dow, date, relative, isToday } = dayLabels(key, todayKey);
          return (
            <section className={isToday ? 'day is-today' : 'day'} key={key}>
              <div className="day-head">
                <span className="dow">{dow}</span>
                <span className="date">{date}</span>
                <span className="relative">{relative}</span>
              </div>
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </section>
          );
        })
      )}

      {undated.length > 0 ? (
        <section className="day">
          <div className="day-head">
            <span className="dow">Date TBC</span>
            <span className="relative">{undated.length} job(s)</span>
          </div>
          {undated.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </section>
      ) : null}

      <p className="footnote">
        Updated {new Intl.DateTimeFormat('en-NZ', {
          timeZone: BUSINESS_TZ,
          hour: 'numeric',
          minute: '2-digit',
          day: 'numeric',
          month: 'short',
        }).format(now)}
        . Refresh the page for the latest.
      </p>
    </>
  );
}
