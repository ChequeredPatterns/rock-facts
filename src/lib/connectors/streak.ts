/**
 * Streak connector — pipeline status for each client.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ SPEC STATUS: NOT VERIFIED.                                              │
 * │                                                                         │
 * │ The build environment's network policy blocked streak.readme.io, so the │
 * │ request details below could not be checked against Streak's own docs.   │
 * │ They follow the widely-reported shape of the Streak v1 API (HTTP Basic  │
 * │ auth, API key as username, empty password) but MUST be confirmed.       │
 * │                                                                         │
 * │ Everything needing verification is in the API_SPEC block below. If the  │
 * │ real API differs, correcting that block is the whole fix — no other     │
 * │ file in this project needs to change.                                   │
 * │                                                                         │
 * │ Verify with:  npm run verify:streak                                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type { JobStatus } from '../domain';
import { extractRef } from '../matcher';
import type { PartialJob } from '../matcher';

/** ⚠ UNVERIFIED — check every value here against Streak's live API docs. */
export const API_SPEC = {
  baseUrl: 'https://www.streak.com/api/v1',
  /** Streak is reported to use HTTP Basic with the API key as the username. */
  auth: (apiKey: string) => ({
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
  }),
  endpoints: {
    me: '/users/me',
    pipelines: '/pipelines',
    pipeline: (key: string) => `/pipelines/${key}`,
    boxes: (pipelineKey: string) => `/pipelines/${pipelineKey}/boxes`,
    stages: (pipelineKey: string) => `/pipelines/${pipelineKey}/stages`,
  },
} as const;

/** Streak box as far as we rely on it. Fields are optional throughout
 *  because we cannot confirm which are guaranteed. */
interface StreakBox {
  boxKey?: string;
  key?: string;
  name?: string;
  stageKey?: string;
  creationTimestamp?: number;
  lastUpdatedTimestamp?: number;
  lastEmailReceivedTimestamp?: number;
  lastEmailSentTimestamp?: number;
  notes?: string;
  emailAddresses?: string[];
  fields?: Record<string, unknown>;
  assignedToSharingEntries?: { email?: string }[];
}

interface StreakStage {
  key?: string;
  name?: string;
}

/**
 * Map a Streak stage NAME to our canonical status.
 *
 * Matching on the name rather than the stage key is deliberate: stage keys are
 * opaque per-pipeline strings, whereas the names are the words the business
 * already uses ("new enquiries", "quoted", "completed job"). If the team
 * renames a stage, add the new wording here.
 */
export function mapStageToStatus(stageName: string | undefined): JobStatus {
  if (!stageName) return 'unknown';
  const s = stageName.toLowerCase().trim();

  // Order matters: check the more specific phrases first. "job not accepted"
  // contains "accepted", so it has to be tested before the accepted rule.
  if (/not\s*accept|declin|lost|dead|cancel/.test(s)) return 'not_accepted';
  if (/complet|done|finish|invoiced|paid/.test(s)) return 'completed';
  if (/accept|confirm|won|booked/.test(s)) return 'accepted';
  if (/quot|proposal|estimate/.test(s)) return 'quoted';
  if (/question|follow|awaiting|pending|info/.test(s)) return 'question';
  if (/new|enquir|inquir|lead/.test(s)) return 'new_enquiry';
  return 'unknown';
}

/** Streak timestamps are reported as epoch milliseconds. */
function toIso(ts: number | undefined): string | undefined {
  if (!ts || !Number.isFinite(ts)) return undefined;
  // Guard against seconds-vs-milliseconds ambiguity: anything below this is
  // clearly seconds (year ~2001 in ms would be impossible for live data).
  const ms = ts < 10_000_000_000 ? ts * 1000 : ts;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

async function streakGet<T>(path: string): Promise<T> {
  const apiKey = process.env.STREAK_API_KEY;
  if (!apiKey) throw new Error('Streak is not configured: STREAK_API_KEY is missing.');

  const res = await fetch(`${API_SPEC.baseUrl}${path}`, {
    headers: { ...API_SPEC.auth(apiKey), Accept: 'application/json' },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'Streak rejected the API key. Check it is current, and that the Streak plan includes API access.',
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Streak request to ${path} failed (${res.status}). ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Confirms the key works and returns the signed-in user, for the setup page. */
export async function verifyStreak(): Promise<{ ok: true; detail: string }> {
  const me = await streakGet<{ email?: string; displayName?: string }>(
    API_SPEC.endpoints.me,
  );
  return {
    ok: true,
    detail: `Connected as ${me.displayName ?? me.email ?? 'unknown user'}`,
  };
}

export async function listPipelines(): Promise<{ key: string; name: string }[]> {
  const pipelines = await streakGet<{ pipelineKey?: string; key?: string; name?: string }[]>(
    API_SPEC.endpoints.pipelines,
  );
  return pipelines
    .map((p) => ({ key: p.pipelineKey ?? p.key ?? '', name: p.name ?? 'Unnamed pipeline' }))
    .filter((p) => p.key);
}

/** Fetch every box in the configured pipeline, mapped to PartialJobs. */
export async function fetchStreakJobs(): Promise<PartialJob[]> {
  const pipelineKey = process.env.STREAK_PIPELINE_KEY;
  if (!pipelineKey) {
    throw new Error(
      'Streak is not configured: STREAK_PIPELINE_KEY is missing. The setup page lists your available pipelines.',
    );
  }

  const [boxes, stages] = await Promise.all([
    streakGet<StreakBox[]>(API_SPEC.endpoints.boxes(pipelineKey)),
    streakGet<StreakStage[]>(API_SPEC.endpoints.stages(pipelineKey)).catch(
      () => [] as StreakStage[],
    ),
  ]);

  // Streak returns stages as either an array or a key-mapped object depending
  // on the endpoint; normalise to a key→name lookup either way.
  const stageNames = new Map<string, string>();
  if (Array.isArray(stages)) {
    for (const st of stages) if (st.key) stageNames.set(st.key, st.name ?? '');
  } else if (stages && typeof stages === 'object') {
    for (const [key, val] of Object.entries(stages as Record<string, StreakStage>)) {
      stageNames.set(key, val?.name ?? '');
    }
  }

  return boxes.map((box) => {
    const id = box.boxKey ?? box.key ?? '';
    const stageName = box.stageKey ? stageNames.get(box.stageKey) : undefined;

    // Last activity is the most recent of the box's own timestamps. A client
    // reply matters more than an internal edit, but either counts as activity.
    const activity = [
      toIso(box.lastUpdatedTimestamp),
      toIso(box.lastEmailReceivedTimestamp),
      toIso(box.lastEmailSentTimestamp),
      toIso(box.creationTimestamp),
    ].filter((v): v is string => Boolean(v));

    return {
      system: 'streak',
      externalId: id,
      url: id ? `https://mail.google.com/mail/u/0/#box/${id}` : undefined,
      lastActivityAt: activity.sort().reverse()[0],
      ref: extractRef(box.name) ?? extractRef(box.notes),
      clientName: box.name?.replace(/\bRF[-\s]?\d{3,}\b/i, '').trim() || 'Unnamed box',
      clientEmail: box.emailAddresses?.[0],
      status: mapStageToStatus(stageName),
    } satisfies PartialJob;
  });
}
