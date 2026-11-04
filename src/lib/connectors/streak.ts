/**
 * Streak connector — pipeline status for each client.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ SPEC STATUS: VERIFIED against the live API on 2026-11-04.               │
 * │                                                                         │
 * │ Verified with a real API key against the live account, and against      │
 * │ Streak's own docs at streak.readme.io/docs/authentication:              │
 * │   • Auth — HTTP Basic, API key as the username, empty password.         │
 * │   • Base URL — https://api.streak.com/api/v1 (the documented host).     │
 * │   • All five endpoints below exist and return 200.                       │
 * │   • Timestamps are epoch MILLISECONDS.                                   │
 * │   • /stages returns an OBJECT keyed by stage key, not an array.          │
 * │   • Every box field read below is present on live boxes.                 │
 * │   • The stage map covers all 15 real stages of the Event Planning        │
 * │     pipeline (see STAGE_RULES).                                          │
 * │                                                                         │
 * │ STILL UNVERIFIED (one item): the box deep-link format used for `url`.   │
 * │ Streak documents no permalink, and no URL is returned in the payload.   │
 * │ See BOX_URL below.                                                      │
 * │                                                                         │
 * │ Re-check at any time with:  npm run verify:streak                       │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type { JobStatus } from '../domain';
import { extractRef } from '../matcher';
import type { PartialJob } from '../matcher';

/** Verified against the live API and Streak's authentication docs. */
export const API_SPEC = {
  /** Documented host. `www.streak.com` also answers, but is not documented. */
  baseUrl: 'https://api.streak.com/api/v1',
  /** Documented: "set the username of the request to the API key. We do not
   *  require a password." */
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
  /**
   * Query parameters on the boxes endpoint. Streak does not document a
   * "list boxes in a pipeline" page at all, so these were established
   * empirically against the live account and confirmed to work:
   *   • `limit=N`        returns exactly N boxes.
   *   • `sortBy=<field>` sorts descending; with `lastUpdatedTimestamp` the
   *                      first result matched the maximum across all 6,180
   *                      boxes, so it really is newest-first.
   * Because they are undocumented they could change without notice, so the
   * result is also bounded client-side in fetchStreakJobs.
   */
  boxQuery: { limitParam: 'limit', sortParam: 'sortBy', sortField: 'lastUpdatedTimestamp' },
} as const;

/**
 * ⚠ UNVERIFIED. Streak documents no box permalink and returns no URL in the
 * box payload, so this is the widely-used community format rather than a
 * confirmed one. If staff report dead links, this single line is the fix.
 */
const BOX_URL = (boxKey: string) => `https://mail.google.com/mail/u/0/#box/${boxKey}`;

/**
 * How many boxes to pull per refresh, newest activity first.
 *
 * This matters a great deal: the live pipeline holds 6,180 boxes and the
 * unbounded response is ~63 MB of JSON, which is far too much to fetch and
 * parse on a dashboard load (and well past a serverless function's comfort).
 * The dashboard only ever shows current work, so the most recently touched
 * boxes are the ones worth having. Raise STREAK_BOX_LIMIT if jobs go missing.
 */
const DEFAULT_BOX_LIMIT = 400;

function boxLimit(): number {
  const raw = Number(process.env.STREAK_BOX_LIMIT);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_BOX_LIMIT;
  return Math.floor(raw);
}

/** Streak box, restricted to the fields verified present on live boxes. */
interface StreakBox {
  boxKey?: string;
  key?: string;
  name?: string;
  stageKey?: string;
  creationTimestamp?: number;
  lastUpdatedTimestamp?: number;
  /** Streak's own "last activity of any kind" stamp. Present on most boxes. */
  lastTouchpointTimestamp?: number;
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
 * Stage name → canonical status, in priority order.
 *
 * Matching on the name rather than the stage key is deliberate: stage keys are
 * opaque per-pipeline strings, whereas the names are the words the business
 * already uses. Each rule below is annotated with the real stage it was
 * written for; the generic patterns at the end catch stages added or renamed
 * later.
 *
 * ORDER IS LOAD-BEARING. Two live stages are only classified correctly
 * because of where their rule sits:
 *   • "Quoted (gets added to calendar as unconfirmed)" must be tested for
 *     "quoted" before anything matches on "confirmed" — hence \bconfirmed\b,
 *     which deliberately does NOT match inside "unconfirmed".
 *   • "Not Booked, Lost Job or Cancelled" must be tested before "booked".
 */
export const STAGE_RULES: readonly { pattern: RegExp; status: JobStatus; stage: string }[] = [
  // --- Dead, excluded or never-a-job -------------------------------------
  {
    pattern: /not\s*booked|not\s*accept|declin|\blost\b|\bdead\b|cancel/,
    status: 'not_accepted',
    stage: 'Not Booked, Lost Job or Cancelled - removed from cal',
  },
  {
    pattern: /blacklist|bounced|invalid|unsubscrib|\bspam\b/,
    status: 'not_accepted',
    stage: 'BLACKLISTED / BOUNCED, INVALID, UNSUBSCRIBED',
  },
  {
    pattern: /not\s*(an?\s*)?events?\b/,
    status: 'not_accepted',
    stage: 'NOT EVENTS',
  },
  {
    // An accounts contact rather than the person booking a job.
    pattern: /accounts\s*payable|not\s*the\s*event\s*organiser/,
    status: 'not_accepted',
    stage: 'Accounts Payable, Invoicing - Not the event organiser',
  },
  {
    // Nurture lists, not live jobs. `not_accepted` is what keeps them off the
    // live board (it is the only status outside OPEN_STATUSES that fits). If
    // the team wants these visible for follow-up, change these two to
    // 'question' — nothing else needs to change.
    pattern: /relationship\s*building|old\s*clients/,
    status: 'not_accepted',
    stage: 'RELATIONSHIP BUILDING / OLD CLIENTS TRYING TO CONTACT',
  },

  // --- Finished -----------------------------------------------------------
  {
    pattern: /complet|previous\s*job|past\s*client|\bdone\b|finish/,
    status: 'completed',
    stage: 'Completed jobs / Previous Jobs / Past Clients',
  },

  // --- Committed and in progress -----------------------------------------
  {
    // Gear is out, or the job is done but unpaid: committed, and still needs
    // chasing, so it must stay on the live board.
    pattern: /^out\b|\bout\s*\(|awaiting\s*return|awaiting\s*payment/,
    status: 'accepted',
    stage: 'OUT (Awaiting Return) OR Awaiting payment still',
  },
  {
    // \bconfirmed\b will not match "unconfirmed" — that is the whole point.
    pattern: /accept|\bconfirmed\b|\bwon\b|\bbooked\b/,
    status: 'accepted',
    stage: 'Accepted - PREPARATION (Gets added to Cal as confirmed)',
  },

  // --- Quoting ------------------------------------------------------------
  {
    pattern: /quot|\bwip|proposal|estimate/,
    status: 'quoted',
    stage: 'Quoted / QUOTING & WIPS',
  },

  // --- Live but waiting on someone ---------------------------------------
  {
    pattern: /question|more\s*info|follow\s*up|limbo|postpon|awaiting|pending|\binfo\b/,
    status: 'question',
    stage: 'Questions, More info needed, Follow up, Limbo... / POSTPONED',
  },

  // --- New ----------------------------------------------------------------
  {
    pattern: /new\s*enquir|new\s*inquir|make\s*contact|enquir|inquir|\blead\b/,
    status: 'new_enquiry',
    stage: 'New Enquiries - MAKE CONTACT',
  },
];

/**
 * Map a Streak stage NAME to our canonical status.
 *
 * Returns 'unknown' only for a stage this map has never seen. Note that
 * 'unknown' is labelled "Not in pipeline" in the UI, so a box sitting in a
 * real stage should never land there — if it does, add a rule above.
 */
export function mapStageToStatus(stageName: string | undefined): JobStatus {
  if (!stageName) return 'unknown';
  const s = stageName.toLowerCase().trim();
  for (const rule of STAGE_RULES) {
    if (rule.pattern.test(s)) return rule.status;
  }
  return 'unknown';
}

/** Streak timestamps are epoch milliseconds (verified on live boxes). */
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

/** Normalise the stages response to a stageKey → name lookup.
 *  Live API returns an object keyed by stage key; an array is tolerated too. */
function stageNameLookup(stages: StreakStage[] | Record<string, StreakStage>): Map<string, string> {
  const names = new Map<string, string>();
  if (Array.isArray(stages)) {
    for (const st of stages) if (st.key) names.set(st.key, st.name ?? '');
  } else if (stages && typeof stages === 'object') {
    for (const [key, val] of Object.entries(stages)) names.set(key, val?.name ?? '');
  }
  return names;
}

/** Fetch the most recently active boxes in the configured pipeline. */
export async function fetchStreakJobs(): Promise<PartialJob[]> {
  const pipelineKey = process.env.STREAK_PIPELINE_KEY;
  if (!pipelineKey) {
    throw new Error(
      'Streak is not configured: STREAK_PIPELINE_KEY is missing. The setup page lists your available pipelines.',
    );
  }

  const limit = boxLimit();
  const { limitParam, sortParam, sortField } = API_SPEC.boxQuery;
  const boxesPath =
    `${API_SPEC.endpoints.boxes(pipelineKey)}` +
    `?${sortParam}=${sortField}&${limitParam}=${limit}`;

  const [boxesRaw, stages] = await Promise.all([
    streakGet<StreakBox[]>(boxesPath),
    streakGet<StreakStage[] | Record<string, StreakStage>>(
      API_SPEC.endpoints.stages(pipelineKey),
    ).catch(() => [] as StreakStage[]),
  ]);

  // Belt and braces: `limit` is undocumented, so if Streak ever stops
  // honouring it we still only process the first `limit` boxes.
  const boxes = (Array.isArray(boxesRaw) ? boxesRaw : []).slice(0, limit);
  const stageNames = stageNameLookup(stages);

  return boxes.map((box) => {
    const id = box.boxKey ?? box.key ?? '';
    const stageName = box.stageKey ? stageNames.get(box.stageKey) : undefined;

    // Last activity is the most recent of the box's own timestamps. Streak's
    // own lastTouchpointTimestamp already accounts for calls and meetings, so
    // it leads; the email stamps cover boxes that have no touchpoint recorded.
    const activity = [
      toIso(box.lastTouchpointTimestamp),
      toIso(box.lastUpdatedTimestamp),
      toIso(box.lastEmailReceivedTimestamp),
      toIso(box.lastEmailSentTimestamp),
      toIso(box.creationTimestamp),
    ].filter((v): v is string => Boolean(v));

    return {
      system: 'streak',
      externalId: id,
      url: id ? BOX_URL(id) : undefined,
      lastActivityAt: activity.sort().reverse()[0],
      ref: extractRef(box.name) ?? extractRef(box.notes),
      clientName: box.name?.replace(/\bRF[-\s]?\d{3,}\b/i, '').trim() || 'Unnamed box',
      clientEmail: box.emailAddresses?.[0],
      status: mapStageToStatus(stageName),
    } satisfies PartialJob;
  });
}
