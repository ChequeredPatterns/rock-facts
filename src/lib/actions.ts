/**
 * The "action needed" engine.
 *
 * This is where Rock Factory Central earns its keep. Each rule encodes a way
 * a job can quietly go wrong when it lives across five systems that do not
 * talk to each other — a quote nobody followed up, a confirmed job with no
 * crew, an event in the calendar that never made it into the pipeline.
 *
 * Design rules:
 *  - Every alert names the job, says what is wrong, and says what to do next.
 *  - Nothing fires on data we do not have. If On Rent is not connected we do
 *    not claim a job is unquoted — we stay silent. A dashboard that cries wolf
 *    gets ignored, and an ignored dashboard is worse than none.
 *  - Thresholds live in one place (`THRESHOLDS`) so they can be tuned by hand
 *    once the team sees real output.
 */

import {
  COMMITTED_STATUSES,
  crewShortfall,
  daysSinceLastActivity,
  daysUntilEvent,
  hasSource,
  SYSTEM_LABELS,
  type Job,
  type SystemId,
} from './domain';

/** "today" / "tomorrow" / "in 5 days" — never the robotic "0 days away". */
function whenPhrase(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export type Severity = 'urgent' | 'soon' | 'fyi';

export interface ActionItem {
  id: string;
  jobId: string;
  job: Job;
  severity: Severity;
  /** Short label, e.g. "No crew booked". */
  title: string;
  /** One sentence of specifics. */
  detail: string;
  /** What the user should actually do, and where. */
  nextStep: string;
  /** Which system the user needs to go to, for a deep link. */
  actIn: SystemId;
}

export const THRESHOLDS = {
  /** An enquiry with no quote after this many days is chased. */
  enquiryUnquotedDays: 2,
  /** A sent quote with no client reply after this many days is followed up. */
  quoteNoReplyDays: 5,
  /** Crew must be locked in this many days before the event. */
  crewLeadDays: 7,
  /** Accepted jobs must be in the calendar this many days out. */
  calendarLeadDays: 14,
  /** Only look this far ahead for staffing/logistics alerts. */
  horizonDays: 60,
};

/** Which systems are actually connected — gates rules that need their data. */
export interface ConnectedSystems {
  streak: boolean;
  onrent: boolean;
  calendar: boolean;
  connecteam: boolean;
  gmail: boolean;
}

const SEVERITY_RANK: Record<Severity, number> = { urgent: 0, soon: 1, fyi: 2 };

export function buildActionList(
  jobs: Job[],
  connected: ConnectedSystems,
  now: Date = new Date(),
): ActionItem[] {
  const items: ActionItem[] = [];
  const push = (i: ActionItem) => items.push(i);

  for (const job of jobs) {
    const until = daysUntilEvent(job, now);
    const idle = daysSinceLastActivity(job, now);
    const isUpcoming = until != null && until >= 0 && until <= THRESHOLDS.horizonDays;

    // --- Rule 1: enquiry sitting unquoted -------------------------------
    // Needs Streak (for status) and On Rent (to know a quote exists).
    if (
      connected.streak &&
      connected.onrent &&
      (job.status === 'new_enquiry' || job.status === 'question') &&
      !hasSource(job, 'onrent') &&
      idle != null &&
      idle >= THRESHOLDS.enquiryUnquotedDays
    ) {
      push({
        id: `${job.id}:unquoted`,
        jobId: job.id,
        job,
        severity: idle >= THRESHOLDS.enquiryUnquotedDays * 3 ? 'urgent' : 'soon',
        title: 'Enquiry not yet quoted',
        detail: `${job.clientName} enquired ${idle} days ago and there is no quote in On Rent Events.`,
        nextStep: 'Build the quote in On Rent Events, then move the Streak box to Quoted.',
        actIn: 'onrent',
      });
    }

    // --- Rule 2: quote sent, client has gone quiet -----------------------
    if (
      connected.streak &&
      job.status === 'quoted' &&
      idle != null &&
      idle >= THRESHOLDS.quoteNoReplyDays
    ) {
      // Escalate if the event itself is close — a silent quote on a job two
      // weeks out is a much bigger problem than one six months out.
      const severity: Severity = until != null && until <= 14 ? 'urgent' : 'soon';
      push({
        id: `${job.id}:quote-silent`,
        jobId: job.id,
        job,
        severity,
        title: 'Quote awaiting reply',
        detail:
          `${job.clientName} was quoted and there has been no activity for ${idle} days` +
          (until != null && until >= 0 ? `, with the event ${whenPhrase(until)}.` : '.'),
        nextStep: 'Follow up the quote by email, then log the reply in Streak.',
        actIn: 'gmail',
      });
    }

    // --- Rule 3: committed job with crew missing -------------------------
    if (
      connected.connecteam &&
      COMMITTED_STATUSES.includes(job.status) &&
      isUpcoming &&
      until! <= THRESHOLDS.crewLeadDays
    ) {
      const short = crewShortfall(job);
      const noneAtAll = job.crew.length === 0;
      if (noneAtAll) {
        push({
          id: `${job.id}:no-crew`,
          jobId: job.id,
          job,
          severity: until! <= 3 ? 'urgent' : 'soon',
          title: 'No crew booked',
          detail: `${job.clientName} is confirmed ${whenPhrase(until!)} and nobody is booked in Connecteam.`,
          nextStep: 'Book the crew in Connecteam for this date.',
          actIn: 'connecteam',
        });
      } else if (short > 0) {
        push({
          id: `${job.id}:short-crew`,
          jobId: job.id,
          job,
          severity: until! <= 3 ? 'urgent' : 'soon',
          title: `Short ${short} crew`,
          detail:
            `${job.clientName} needs ${job.crewRequired} crew and ${job.crew.filter((c) => c.confirmed).length} ` +
            `are confirmed, with the job ${whenPhrase(until!)}.`,
          nextStep: 'Assign or chase confirmation for the remaining crew in Connecteam.',
          actIn: 'connecteam',
        });
      }
    }

    // --- Rule 4: accepted job missing from the calendar ------------------
    if (
      connected.calendar &&
      job.status === 'accepted' &&
      !hasSource(job, 'calendar') &&
      isUpcoming &&
      until! <= THRESHOLDS.calendarLeadDays
    ) {
      push({
        id: `${job.id}:no-calendar`,
        jobId: job.id,
        job,
        severity: 'urgent',
        title: 'Not in the calendar',
        detail: `${job.clientName} is accepted for ${whenPhrase(until!)} but has no Google Calendar entry.`,
        nextStep: 'Add the event to the Live Event calendar so the whole team can see it.',
        actIn: 'calendar',
      });
    }

    // --- Rule 5: calendar booking that never entered the pipeline --------
    // The reverse blind spot: work the team is doing that nothing tracks.
    if (
      connected.streak &&
      connected.calendar &&
      hasSource(job, 'calendar') &&
      !hasSource(job, 'streak') &&
      isUpcoming
    ) {
      push({
        id: `${job.id}:untracked`,
        jobId: job.id,
        job,
        severity: 'fyi',
        title: 'Not tracked in Streak',
        detail: `"${job.clientName}" is in the calendar ${whenPhrase(until!)} but has no Streak box.`,
        nextStep: 'Create a Streak box so the job is tracked, or confirm it is not a client job.',
        actIn: 'streak',
      });
    }

    // --- Rule 6: uncertain cross-system match ---------------------------
    // Surfaced so a bad automatic join can be caught by a human.
    if (job.matchConfidence === 'low' && job.sources.length > 1) {
      push({
        id: `${job.id}:weak-match`,
        jobId: job.id,
        job,
        severity: 'fyi',
        title: 'Uncertain record match',
        detail:
          `Records from ${job.sources.map((s) => SYSTEM_LABELS[s.system]).join(' and ')} were linked for ` +
          `${job.clientName}, but the match is not certain.`,
        nextStep:
          'Check these are the same job. Adding a shared job number (e.g. RF-1042) to both makes this exact.',
        actIn: 'streak',
      });
    }
  }

  return items.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    // Within a severity, soonest event first; undated last.
    const da = daysUntilEvent(a.job, now) ?? 9999;
    const db = daysUntilEvent(b.job, now) ?? 9999;
    return da - db;
  });
}

export function countBySeverity(items: ActionItem[]): Record<Severity, number> {
  return items.reduce(
    (acc, i) => {
      acc[i.severity] += 1;
      return acc;
    },
    { urgent: 0, soon: 0, fyi: 0 } as Record<Severity, number>,
  );
}
