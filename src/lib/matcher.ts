/**
 * Cross-system job matching.
 *
 * THE CORE PROBLEM: Streak, On Rent Events, Google Calendar and Connecteam
 * share no common identifier. A dashboard that just lists all four side by
 * side is no better than four browser tabs. The value is in knowing that
 * "Smith 21st" in the calendar, box "Jane Smith - 21st birthday" in Streak,
 * and quote #1042 in On Rent are all ONE job — so we can say "this job is
 * accepted, happens Saturday, and has no crew booked".
 *
 * STRATEGY, strongest signal first:
 *
 *   1. Shared reference ("RF-1042"). If staff write the quote number into the
 *      Streak box name and calendar event title, matching is exact. This is by
 *      far the most reliable route and the one worth adopting as a habit.
 *   2. Client email. Exact, when the system records it.
 *   3. Normalised client name + event date within a tolerance window.
 *
 * Every match records a confidence and a human-readable reason, and the UI
 * shows low-confidence joins as uncertain rather than asserting them. A wrong
 * silent merge is worse than no merge: it hides a job.
 */

import type { Job, MatchConfidence, SourceRecord, SystemId } from './domain';

/** A single system's view of a job, before merging. */
export interface PartialJob {
  system: SystemId;
  externalId: string;
  url?: string;
  lastActivityAt?: string;

  ref?: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  status?: Job['status'];
  eventStart?: string;
  eventEnd?: string;
  venue?: string;
  quoteTotal?: number;
  crew?: Job['crew'];
  crewRequired?: number;
}

/** Days apart two event dates may be and still be considered the same job. */
const DATE_TOLERANCE_DAYS = 1;

/**
 * Pull a job reference out of free text. Matches the common shapes a business
 * actually types: "RF-1042", "RF1042", "#1042", "Quote 1042", "Job 1042".
 * Deliberately requires 3+ digits so a bare "21st" in an event title is not
 * mistaken for a job number.
 */
export function extractRef(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const patterns = [
    /\bRF[-\s]?(\d{3,})\b/i,
    /#(\d{3,})\b/,
    /\b(?:quote|job|invoice)[-\s#]*(\d{3,})\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return `RF-${m[1]}`;
  }
  return undefined;
}

/**
 * Reduce a client name to a comparable key. Strips punctuation, company
 * suffixes and common event noise so "Jane Smith" matches "Smith, Jane" and
 * "Acme Ltd." matches "ACME".
 */
export function normaliseName(name: string | undefined): string {
  if (!name) return '';
  let s = name.toLowerCase();
  // Drop anything in brackets — often a venue or note, not the name.
  s = s.replace(/\([^)]*\)/g, ' ');
  // Remove company suffixes and event-ish words that vary between systems.
  // Note the plural forms: real records say "Harbourside Weddings" in one
  // system and "Harbourside" in another, and a singular-only list silently
  // fails to match them.
  s = s.replace(
    /\b(ltd|limited|pty|inc|llc|co|company|the|weddings?|birthdays?|party|parties|events?|functions?|hire|rentals?|\d{1,3}(?:st|nd|rd|th))\b/g,
    ' ',
  );
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  const words = s.split(/\s+/).filter(Boolean);
  // Sort so word order does not matter ("Smith Jane" == "Jane Smith").
  return words.sort().join(' ');
}

function daysApart(a: string | undefined, b: string | undefined): number | undefined {
  if (!a || !b) return undefined;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return undefined;
  return Math.abs(ta - tb) / 86_400_000;
}

/** Do two partials refer to the same job? Returns confidence, or null. */
export function scoreMatch(
  a: PartialJob,
  b: PartialJob,
): { confidence: MatchConfidence; reason: string } | null {
  // 1. Shared explicit reference — the gold standard.
  if (a.ref && b.ref && a.ref === b.ref) {
    return { confidence: 'exact', reason: `Matched on job reference ${a.ref}` };
  }

  const nameA = normaliseName(a.clientName);
  const nameB = normaliseName(b.clientName);
  const sameName = nameA.length > 0 && nameA === nameB;
  const gap = daysApart(a.eventStart, b.eventStart);
  const datesAgree = gap != null && gap <= DATE_TOLERANCE_DAYS;

  // 2. Client email — exact identity, but a client can have several jobs, so
  //    we still require the dates to agree when both systems know a date.
  if (a.clientEmail && b.clientEmail && a.clientEmail.toLowerCase() === b.clientEmail.toLowerCase()) {
    if (gap == null) {
      return {
        confidence: 'high',
        reason: `Matched on client email ${a.clientEmail} (no date to cross-check)`,
      };
    }
    if (datesAgree) {
      return { confidence: 'exact', reason: `Matched on client email and event date` };
    }
    // Same client, clearly different event — not a match.
    return null;
  }

  // 3. Name + date.
  if (sameName && datesAgree) {
    return {
      confidence: 'high',
      reason: `Matched on client name and event date (${gap === 0 ? 'same day' : `${gap} day apart`})`,
    };
  }

  // Name agrees but only one side has a date: plausible, flagged as weak.
  if (sameName && gap == null && (a.eventStart == null || b.eventStart == null)) {
    return {
      confidence: 'low',
      reason: 'Matched on client name only — no event date to confirm. Please verify.',
    };
  }

  return null;
}

const CONFIDENCE_RANK: Record<MatchConfidence, number> = { low: 0, high: 1, exact: 2 };

function weakest(a: MatchConfidence, b: MatchConfidence): MatchConfidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

/** Precedence for each field: which system do we believe when they disagree? */
const STATUS_AUTHORITY: SystemId[] = ['streak', 'onrent', 'calendar'];
const TIMING_AUTHORITY: SystemId[] = ['calendar', 'onrent', 'connecteam', 'streak'];
const MONEY_AUTHORITY: SystemId[] = ['onrent', 'streak'];
const CREW_AUTHORITY: SystemId[] = ['connecteam', 'calendar'];

function pick<T>(
  parts: PartialJob[],
  authority: SystemId[],
  get: (p: PartialJob) => T | undefined,
): T | undefined {
  for (const system of authority) {
    for (const p of parts) {
      if (p.system !== system) continue;
      const v = get(p);
      if (v !== undefined && v !== null && v !== '') return v;
    }
  }
  // Fall back to any system that has a value at all.
  for (const p of parts) {
    const v = get(p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * Merge a cluster of partials into one Job, resolving field conflicts by
 * source authority — Calendar owns timing, On Rent owns money, Streak owns
 * pipeline status, Connecteam owns crew. Each system is trusted for what it
 * is actually the system of record for.
 */
export function mergeCluster(
  parts: PartialJob[],
  confidence: MatchConfidence,
  reason?: string,
): Job {
  const sources: SourceRecord[] = parts.map((p) => ({
    system: p.system,
    externalId: p.externalId,
    url: p.url,
    lastActivityAt: p.lastActivityAt,
  }));

  // Prefer a Streak-derived id so the job keeps a stable identity as other
  // systems come and go; otherwise take the first available.
  const anchor =
    parts.find((p) => p.system === 'streak') ??
    parts.find((p) => p.system === 'onrent') ??
    parts[0];

  const crew = pick(parts, CREW_AUTHORITY, (p) => (p.crew?.length ? p.crew : undefined)) ?? [];

  return {
    id: `${anchor.system}:${anchor.externalId}`,
    ref: pick(parts, ['streak', 'onrent', 'calendar'], (p) => p.ref),
    clientName: pick(parts, ['streak', 'onrent', 'calendar'], (p) => p.clientName) ?? 'Unknown client',
    clientEmail: pick(parts, ['streak', 'onrent'], (p) => p.clientEmail),
    clientPhone: pick(parts, ['onrent', 'streak'], (p) => p.clientPhone),
    status: pick(parts, STATUS_AUTHORITY, (p) => p.status) ?? 'unknown',
    eventStart: pick(parts, TIMING_AUTHORITY, (p) => p.eventStart),
    eventEnd: pick(parts, TIMING_AUTHORITY, (p) => p.eventEnd),
    venue: pick(parts, TIMING_AUTHORITY, (p) => p.venue),
    quoteTotal: pick(parts, MONEY_AUTHORITY, (p) => p.quoteTotal),
    crew,
    crewRequired: pick(parts, ['onrent', 'connecteam', 'streak'], (p) => p.crewRequired),
    sources,
    matchConfidence: parts.length > 1 ? confidence : 'exact',
    matchReason: parts.length > 1 ? reason : undefined,
  };
}

/**
 * Cluster all partials from every system into Jobs.
 *
 * Union-find style agglomeration: each partial joins the first existing
 * cluster it matches. We deliberately avoid merging two partials from the
 * SAME system into one cluster — two Streak boxes are two jobs, even for the
 * same client on the same day — which also stops one popular client from
 * collapsing their whole history into a single row.
 */
export function clusterJobs(partials: PartialJob[]): Job[] {
  interface Cluster {
    parts: PartialJob[];
    confidence: MatchConfidence;
    reason?: string;
  }
  const clusters: Cluster[] = [];

  // Process the most authoritative systems first so clusters form around a
  // Streak box or On Rent quote rather than around a bare calendar entry.
  const order: SystemId[] = ['streak', 'onrent', 'calendar', 'connecteam', 'gmail'];
  const sorted = [...partials].sort(
    (a, b) => order.indexOf(a.system) - order.indexOf(b.system),
  );

  for (const part of sorted) {
    let placed = false;
    for (const cluster of clusters) {
      if (cluster.parts.some((p) => p.system === part.system)) continue;

      // Match against the strongest member of the cluster.
      let best: { confidence: MatchConfidence; reason: string } | null = null;
      for (const member of cluster.parts) {
        const result = scoreMatch(member, part);
        if (result && (!best || CONFIDENCE_RANK[result.confidence] > CONFIDENCE_RANK[best.confidence])) {
          best = result;
        }
      }

      if (best) {
        cluster.parts.push(part);
        cluster.confidence = weakest(cluster.confidence, best.confidence);
        cluster.reason ??= best.reason;
        if (CONFIDENCE_RANK[best.confidence] <= CONFIDENCE_RANK[cluster.confidence]) {
          cluster.reason = best.reason;
        }
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ parts: [part], confidence: 'exact' });
    }
  }

  return clusters.map((c) => mergeCluster(c.parts, c.confidence, c.reason));
}
