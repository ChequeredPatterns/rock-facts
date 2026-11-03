/**
 * The Rock Factory Central — core domain model.
 *
 * Every connected system (Streak, On Rent Events, Google Calendar, Connecteam,
 * Gmail) describes the same real-world thing from a different angle:
 *
 *   Streak           → where the client sits in the pipeline
 *   On Rent Events   → the quote and what gear it covers
 *   Google Calendar  → when and where the event actually happens
 *   Connecteam       → which crew are booked to work it
 *   Gmail            → the conversation with the client
 *
 * Rock Factory Central folds those five views into one `Job`. Everything in
 * the UI reads from `Job`, never from a vendor payload directly, so a change
 * in any vendor's API shape stops at the connector boundary.
 */

/** The business timezone. The Rock Factory runs on NZ time; all day-bucketing
 *  and "is this overdue" logic resolves against this, never the server's TZ. */
export const BUSINESS_TZ = 'Pacific/Auckland';
export const CURRENCY = 'NZD';

/**
 * Pipeline status, mirroring the Streak stages described by the business.
 * `unknown` exists for jobs discovered in another system (e.g. a calendar
 * booking) that have no Streak box yet — those are a real risk and we surface
 * them rather than hiding them.
 */
export type JobStatus =
  | 'new_enquiry'
  | 'question'
  | 'quoted'
  | 'accepted'
  | 'completed'
  | 'not_accepted'
  | 'unknown';

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  new_enquiry: 'New enquiry',
  question: 'Question',
  quoted: 'Quoted',
  accepted: 'Accepted',
  completed: 'Completed job',
  not_accepted: 'Job not accepted',
  unknown: 'Not in pipeline',
};

/** Statuses that mean the job is still live and needs attention. */
export const OPEN_STATUSES: readonly JobStatus[] = [
  'new_enquiry',
  'question',
  'quoted',
  'accepted',
  'unknown',
];

/** Statuses where the work is committed, so crew and logistics must be sorted. */
export const COMMITTED_STATUSES: readonly JobStatus[] = ['accepted', 'completed'];

export type SystemId = 'streak' | 'onrent' | 'calendar' | 'connecteam' | 'gmail';

export const SYSTEM_LABELS: Record<SystemId, string> = {
  streak: 'Streak',
  onrent: 'On Rent Events',
  calendar: 'Google Calendar',
  connecteam: 'Connecteam',
  gmail: 'Gmail',
};

export interface CrewAssignment {
  /** Connecteam user id where known, else a calendar-derived identifier. */
  id: string;
  name: string;
  /** Free-text role as the source system records it, e.g. "Sound", "Lighting". */
  role?: string;
  shiftStart?: string;
  shiftEnd?: string;
  /** True when the crew member has accepted/confirmed the shift. */
  confirmed: boolean;
  source: SystemId;
}

/**
 * How confident we are that the records stitched into this Job really are the
 * same job. Surfaced in the UI: a `low` match is shown with a warning rather
 * than silently presented as fact.
 */
export type MatchConfidence = 'exact' | 'high' | 'low';

export interface SourceRecord {
  system: SystemId;
  /** Vendor's own id for the record, for deep-linking and debugging. */
  externalId: string;
  /** Direct URL into the vendor UI, so staff can jump to the source of truth. */
  url?: string;
  /** When the vendor record was last touched — drives staleness rules. */
  lastActivityAt?: string;
}

export interface Job {
  /** Stable internal id, derived from the strongest available source record. */
  id: string;
  /**
   * Shared job/quote reference, e.g. "RF-1042". When staff put this in the
   * Streak box name, the calendar event title and the On Rent quote, matching
   * becomes exact and this whole system gets dramatically more reliable.
   */
  ref?: string;

  clientName: string;
  clientEmail?: string;
  clientPhone?: string;

  status: JobStatus;

  /** Event timing. Absent for enquiries with no date pinned down yet. */
  eventStart?: string;
  eventEnd?: string;
  venue?: string;

  /** Quote value in NZD, from On Rent Events. */
  quoteTotal?: number;

  crew: CrewAssignment[];
  /** How many crew the job needs. Drives the understaffed warning. */
  crewRequired?: number;

  /** One entry per system that knows about this job. */
  sources: SourceRecord[];
  matchConfidence: MatchConfidence;

  /** Short human note on how the match was made, shown on hover. */
  matchReason?: string;
}

// ---------------------------------------------------------------------------
// Derived helpers. Kept pure so they are trivially testable.
// ---------------------------------------------------------------------------

export function hasSource(job: Job, system: SystemId): boolean {
  return job.sources.some((s) => s.system === system);
}

export function sourceUrl(job: Job, system: SystemId): string | undefined {
  return job.sources.find((s) => s.system === system)?.url;
}

export function confirmedCrewCount(job: Job): number {
  return job.crew.filter((c) => c.confirmed).length;
}

/**
 * Crew shortfall for a job. Returns 0 when fully staffed or when we have no
 * requirement recorded — we never invent a requirement, because a false
 * "understaffed" warning trains people to ignore the dashboard.
 */
export function crewShortfall(job: Job): number {
  if (job.crewRequired == null) return 0;
  return Math.max(0, job.crewRequired - confirmedCrewCount(job));
}

/** Whole days from `now` until the event. Negative once the event has passed. */
export function daysUntilEvent(job: Job, now: Date = new Date()): number | undefined {
  if (!job.eventStart) return undefined;
  const start = new Date(job.eventStart).getTime();
  return Math.floor((start - now.getTime()) / 86_400_000);
}

/** Days since anything at all happened on this job in any system. */
export function daysSinceLastActivity(job: Job, now: Date = new Date()): number | undefined {
  const stamps = job.sources
    .map((s) => s.lastActivityAt)
    .filter((v): v is string => Boolean(v))
    .map((v) => new Date(v).getTime())
    .filter((t) => Number.isFinite(t));
  if (stamps.length === 0) return undefined;
  return Math.floor((now.getTime() - Math.max(...stamps)) / 86_400_000);
}

export function formatMoney(amount: number | undefined): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: CURRENCY,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Calendar day key (YYYY-MM-DD) for an instant, resolved in business time. */
export function businessDayKey(iso: string): string {
  // en-CA gives YYYY-MM-DD, which sorts lexicographically.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/**
 * Offset of the business timezone from UTC, in minutes, at a given instant.
 * Computed rather than hardcoded because New Zealand observes daylight saving
 * (+12 in winter, +13 in summer), so a fixed offset is wrong half the year.
 */
export function businessOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return (asIfUtc - at.getTime()) / 60_000;
}

/**
 * Build the instant at which the business-local wall clock reads
 * `year-month-day hour:00`. Used wherever we need "3pm in Auckland" rather
 * than "3pm wherever this server happens to be running" — which on Vercel is
 * UTC, and would otherwise shift every displayed time by up to 13 hours.
 */
export function businessInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): string {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  // One refinement pass settles the DST boundary cases.
  let instant = naive - businessOffsetMinutes(new Date(naive)) * 60_000;
  instant = naive - businessOffsetMinutes(new Date(instant)) * 60_000;
  return new Date(instant).toISOString();
}

/** The business-local calendar date, `dayOffset` days from `base`. */
export function businessDateParts(
  base: Date,
  dayOffset = 0,
): { year: number; month: number; day: number } {
  const shifted = new Date(base.getTime() + dayOffset * 86_400_000);
  const [year, month, day] = businessDayKey(shifted.toISOString()).split('-').map(Number);
  return { year, month, day };
}

function timeFormatter(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: BUSINESS_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatEventTime(job: Job): string {
  if (!job.eventStart) return 'Date TBC';
  const fmt = timeFormatter();
  const start = fmt.format(new Date(job.eventStart));
  if (!job.eventEnd) return start;
  return `${start} – ${fmt.format(new Date(job.eventEnd))}`;
}

/**
 * Start and end as separate strings, so the UI can stack them rather than
 * wrapping a single "9:00 am – 6:00 pm" string mid-value.
 */
export function eventTimeParts(job: Job): { start: string; end?: string } {
  if (!job.eventStart) return { start: 'TBC' };
  const fmt = timeFormatter();
  return {
    start: fmt.format(new Date(job.eventStart)),
    end: job.eventEnd ? fmt.format(new Date(job.eventEnd)) : undefined,
  };
}
