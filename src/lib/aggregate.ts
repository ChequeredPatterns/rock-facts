/**
 * Fetches every connected system, merges the results into Jobs, and reports
 * per-system health.
 *
 * KEY BEHAVIOUR: a failure in one system never blanks the dashboard. If
 * Connecteam is down, you still see the calendar and the pipeline, with a
 * clear banner saying crew data is missing. A dashboard that shows nothing
 * when one of five vendors has a bad morning would not survive contact with
 * a real workday.
 */

import { isConfigured } from './config';
import type { Job, SystemId } from './domain';
import { clusterJobs, type PartialJob } from './matcher';
import { buildActionList, type ActionItem, type ConnectedSystems } from './actions';
import { fetchCalendarJobs } from './connectors/google';
import { fetchStreakJobs } from './connectors/streak';
import { fetchConnecteamJobs } from './connectors/connecteam';
import { fetchOnRentJobs } from './connectors/onrent';
import { sampleJobs } from './sample-data';

export interface SystemHealth {
  system: SystemId;
  configured: boolean;
  ok: boolean;
  /** Number of records pulled, when successful. */
  records?: number;
  /** Plain-English error, safe to show a non-technical user. */
  error?: string;
}

export interface DashboardData {
  jobs: Job[];
  actions: ActionItem[];
  health: SystemHealth[];
  isSample: boolean;
  fetchedAt: string;
  /** Window the data covers. */
  from: string;
  to: string;
}

/** How far back and forward the dashboard looks. */
const LOOKBACK_DAYS = 30;
const LOOKAHEAD_DAYS = 120;

type Fetcher = (from: Date, to: Date) => Promise<PartialJob[]>;

const FETCHERS: { system: SystemId; fetch: Fetcher }[] = [
  { system: 'streak', fetch: () => fetchStreakJobs() },
  { system: 'onrent', fetch: (f, t) => fetchOnRentJobs(f, t) },
  { system: 'calendar', fetch: (f, t) => fetchCalendarJobs(f, t) },
  { system: 'connecteam', fetch: (f, t) => fetchConnecteamJobs(f, t) },
];

function friendlyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred.';
}

export async function loadDashboard(now: Date = new Date()): Promise<DashboardData> {
  const from = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000);

  // Sample mode: show the full interface with clearly-labelled example data
  // so the team can critique the design before any credentials exist.
  const sample = (await import('./config')).useSampleData();
  if (sample) {
    const jobs = sampleJobs(now);
    const connected: ConnectedSystems = {
      streak: true,
      onrent: true,
      calendar: true,
      connecteam: true,
      gmail: true,
    };
    return {
      jobs,
      actions: buildActionList(jobs, connected, now),
      health: (['streak', 'onrent', 'calendar', 'connecteam', 'gmail'] as SystemId[]).map((s) => ({
        system: s,
        configured: false,
        ok: false,
        error: 'Showing sample data — not connected yet.',
      })),
      isSample: true,
      fetchedAt: now.toISOString(),
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  const health: SystemHealth[] = [];
  const partials: PartialJob[] = [];

  // Fetch every configured system in parallel; isolate each failure.
  const results = await Promise.all(
    FETCHERS.map(async ({ system, fetch }) => {
      if (!isConfigured(system)) {
        return { system, configured: false, ok: false, parts: [] as PartialJob[] };
      }
      try {
        const parts = await fetch(from, to);
        return { system, configured: true, ok: true, parts };
      } catch (err) {
        return {
          system,
          configured: true,
          ok: false,
          parts: [] as PartialJob[],
          error: friendlyError(err),
        };
      }
    }),
  );

  for (const r of results) {
    health.push({
      system: r.system,
      configured: r.configured,
      ok: r.ok,
      records: r.ok ? r.parts.length : undefined,
      error: 'error' in r ? (r.error as string) : undefined,
    });
    partials.push(...r.parts);
  }

  // Gmail shares Google's credentials and has no job records of its own.
  health.push({
    system: 'gmail',
    configured: isConfigured('gmail'),
    ok: isConfigured('gmail'),
  });

  const jobs = clusterJobs(partials);

  // Only run a rule when the systems it depends on actually returned data,
  // so we never claim "no crew booked" merely because Connecteam errored.
  const connected: ConnectedSystems = {
    streak: health.find((h) => h.system === 'streak')?.ok ?? false,
    onrent: health.find((h) => h.system === 'onrent')?.ok ?? false,
    calendar: health.find((h) => h.system === 'calendar')?.ok ?? false,
    connecteam: health.find((h) => h.system === 'connecteam')?.ok ?? false,
    gmail: health.find((h) => h.system === 'gmail')?.ok ?? false,
  };

  return {
    jobs,
    actions: buildActionList(jobs, connected, now),
    health,
    isSample: false,
    fetchedAt: now.toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
  };
}
