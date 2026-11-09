/**
 * Connecteam connector — which crew are booked on each job.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ SPEC STATUS: NOT VERIFIED.                                              │
 * │                                                                         │
 * │ developer.connecteam.com was blocked by this build environment's        │
 * │ network policy. The paths below follow Connecteam's published Scheduler │
 * │ API shape as reported by search results, but are UNCONFIRMED.           │
 * │                                                                         │
 * │ Two things to confirm before trusting this connector:                   │
 * │  1. Timestamp units on shifts (seconds vs milliseconds vs ISO). The     │
 * │     `toIso` helper below guesses defensively, but guessing is not the   │
 * │     same as knowing.                                                    │
 * │  2. Plan gating. Connecteam's help centre says API access is Enterprise │
 * │     only; a third-party review says Expert tier. Confirm with           │
 * │     Connecteam BEFORE anyone pays to upgrade for this.                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type { CrewAssignment } from '../domain';
import { extractRef } from '../matcher';
import type { PartialJob } from '../matcher';

/** ⚠ UNVERIFIED — confirm against Connecteam's Scheduler API docs. */
export const API_SPEC = {
  baseUrl: 'https://api.connecteam.com',
  /** Reported as an API-key header. Confirm the exact header name. */
  auth: (apiKey: string) => ({ 'X-API-KEY': apiKey }),
  endpoints: {
    schedulers: '/scheduler/v1/schedulers',
    shifts: (schedulerId: string) => `/scheduler/v1/schedulers/${schedulerId}/shifts`,
    users: '/users/v1/users',
  },
  /** Scope required for read access. */
  readScope: 'schedule.read',
} as const;

interface ConnecteamShift {
  id?: string | number;
  shiftId?: string | number;
  title?: string;
  startTime?: number | string;
  endTime?: number | string;
  isOpenShift?: boolean;
  status?: string;
  locationData?: { address?: string; name?: string };
  jobId?: string;
  /**
   * Confirmed against the live API: this is an ARRAY, not the string the name
   * suggests. Typed loosely and flattened by `notesText` below, because the
   * entry shape is not documented and was empty in every live sample.
   */
  notes?: unknown;
  assignedUserIds?: (string | number)[];
  users?: { userId?: string | number; firstName?: string; lastName?: string; status?: string }[];
}

interface ConnecteamUser {
  userId?: string | number;
  id?: string | number;
  firstName?: string;
  lastName?: string;
}

/**
 * Normalise a Connecteam timestamp. The API's unit is unconfirmed, so this
 * handles seconds, milliseconds and ISO strings rather than assuming one and
 * silently producing dates in 1970 or the year 55000.
 */
function toIso(value: number | string | undefined): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (!Number.isFinite(value)) return undefined;
  // Below ~Nov 2286 in seconds; anything smaller is seconds, larger is ms.
  const ms = value < 10_000_000_000 ? value * 1000 : value;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

async function ctGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const apiKey = process.env.CONNECTEAM_API_KEY;
  if (!apiKey) throw new Error('Connecteam is not configured: CONNECTEAM_API_KEY is missing.');

  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const res = await fetch(`${API_SPEC.baseUrl}${path}${qs}`, {
    headers: { ...API_SPEC.auth(apiKey), Accept: 'application/json' },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'Connecteam rejected the API key. Confirm the key is valid and that your Connecteam plan includes API access.',
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Connecteam request to ${path} failed (${res.status}). ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** A scheduler as the setup page needs it: a name to recognise, an ID to copy. */
export interface SchedulerSummary {
  id: string;
  name: string;
}

/**
 * List the schedulers on the account, so the Setup page can show their IDs.
 *
 * This exists because `CONNECTEAM_SCHEDULER_ID` is not discoverable anywhere in
 * Connecteam's own web interface. Without this the only way to find it is the
 * `verify:connecteam` terminal script, which breaks the promise that nobody on
 * the team ever has to open a terminal.
 */
export async function listConnecteamSchedulers(): Promise<SchedulerSummary[]> {
  const data = await ctGet<{
    data?: { schedulers?: { id?: string | number; schedulerId?: string | number; name?: string }[] };
    schedulers?: { id?: string | number; schedulerId?: string | number; name?: string }[];
  }>(API_SPEC.endpoints.schedulers);

  // The documented shape is data.schedulers; accept a bare top-level array too,
  // since this connector's spec is not yet confirmed against the live API.
  const raw = data?.data?.schedulers ?? data?.schedulers ?? [];

  return raw
    .map((s) => {
      const id = s.id ?? s.schedulerId;
      return id == null ? null : { id: String(id), name: s.name ?? String(id) };
    })
    .filter((s): s is SchedulerSummary => s !== null);
}

export async function verifyConnecteam(): Promise<{ ok: true; detail: string }> {
  const schedulers = await listConnecteamSchedulers();
  return {
    ok: true,
    detail:
      schedulers.length > 0
        ? `Connected. Schedulers found: ${schedulers.map((s) => `${s.name} (${s.id})`).join(', ')}`
        : 'Connected, but no schedulers were returned.',
  };
}

/**
 * The longest span Connecteam will accept on the shifts endpoint.
 *
 * Confirmed against the live API, which answers a wider request with
 * HTTP 400 and "Date range cannot be more than 92 days". The dashboard asks
 * for 150 days (30 back, 120 ahead), so a single call always failed and crew
 * never loaded at all. 90 leaves a margin in case the limit is measured
 * slightly differently at their end.
 */
export const MAX_WINDOW_DAYS = 90;

/** Only a genuine string, so a surprising API shape cannot crash a caller. */
function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * Flatten whatever `notes` turns out to be into searchable text.
 *
 * Live responses give an array; the entries were empty in every sample, so
 * both plain strings and objects carrying a text-ish field are handled rather
 * than guessing one and being wrong.
 */
export function notesText(notes: unknown): string | undefined {
  const parts: string[] = [];
  const visit = (v: unknown, depth = 0): void => {
    if (depth > 3 || v == null) return;
    if (typeof v === 'string') {
      if (v.trim()) parts.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    if (typeof v === 'object') {
      for (const key of ['text', 'note', 'body', 'content', 'value']) {
        const inner = (v as Record<string, unknown>)[key];
        if (typeof inner === 'string' && inner.trim()) parts.push(inner);
      }
    }
  };
  visit(notes);
  return parts.length ? parts.join(' ') : undefined;
}

/** Split a span into consecutive windows no longer than the API allows. */
export function splitIntoWindows(
  from: Date,
  to: Date,
  maxDays = MAX_WINDOW_DAYS,
): { from: Date; to: Date }[] {
  const span = maxDays * 86_400_000;
  if (!(to.getTime() > from.getTime())) return [{ from, to }];

  const windows: { from: Date; to: Date }[] = [];
  let cursor = from.getTime();
  while (cursor < to.getTime()) {
    const end = Math.min(cursor + span, to.getTime());
    windows.push({ from: new Date(cursor), to: new Date(end) });
    cursor = end;
  }
  return windows;
}

/**
 * Fetch shifts in a window and group them into one PartialJob per shift title
 * + date. Connecteam models individual shifts, not jobs, so several crew on
 * the same event arrive as separate shift records that we fold together.
 */
export async function fetchConnecteamJobs(from: Date, to: Date): Promise<PartialJob[]> {
  const schedulerId = process.env.CONNECTEAM_SCHEDULER_ID;
  if (!schedulerId) {
    throw new Error('Connecteam is not configured: CONNECTEAM_SCHEDULER_ID is missing.');
  }

  const [shiftChunks, userPayload] = await Promise.all([
    Promise.all(
      splitIntoWindows(from, to).map((w) =>
        ctGet<{ data?: { shifts?: ConnecteamShift[] } }>(API_SPEC.endpoints.shifts(schedulerId), {
          startTime: String(Math.floor(w.from.getTime() / 1000)),
          endTime: String(Math.floor(w.to.getTime() / 1000)),
          limit: '500',
        }),
      ),
    ),
    ctGet<{ data?: { users?: ConnecteamUser[] } }>(API_SPEC.endpoints.users, {
      limit: '500',
    }).catch(() => ({ data: { users: [] as ConnecteamUser[] } })),
  ]);

  const userNames = new Map<string, string>();
  for (const u of userPayload?.data?.users ?? []) {
    const id = String(u.userId ?? u.id ?? '');
    if (id) userNames.set(id, [u.firstName, u.lastName].filter(Boolean).join(' ') || id);
  }

  // De-duplicate across windows: a shift on a boundary can come back twice.
  const seen = new Set<string>();
  const shifts: ConnecteamShift[] = [];
  for (const chunk of shiftChunks) {
    for (const s of chunk?.data?.shifts ?? []) {
      const id = String(s.id ?? s.shiftId ?? `${s.title}|${s.startTime}|${s.endTime}`);
      if (seen.has(id)) continue;
      seen.add(id);
      shifts.push(s);
    }
  }

  // Group shifts that belong to the same job: same title, same calendar day.
  const groups = new Map<string, { shifts: ConnecteamShift[]; start?: string }>();
  for (const shift of shifts) {
    const start = toIso(shift.startTime);
    const dayKey = start ? start.slice(0, 10) : 'undated';
    const key = `${(shift.title ?? 'untitled').toLowerCase().trim()}|${dayKey}`;
    const existing = groups.get(key);
    if (existing) existing.shifts.push(shift);
    else groups.set(key, { shifts: [shift], start });
  }

  const partials: PartialJob[] = [];
  for (const [key, group] of groups) {
    const first = group.shifts[0];
    const crew: CrewAssignment[] = [];

    for (const shift of group.shifts) {
      // Open (unassigned) shifts are a staffing gap, not a crew member.
      if (shift.isOpenShift) continue;

      const ids = shift.assignedUserIds?.map(String) ?? [];
      const embedded = shift.users ?? [];

      if (embedded.length > 0) {
        for (const u of embedded) {
          const id = String(u.userId ?? '');
          crew.push({
            id,
            name:
              [u.firstName, u.lastName].filter(Boolean).join(' ') || userNames.get(id) || id,
            shiftStart: toIso(shift.startTime),
            shiftEnd: toIso(shift.endTime),
            confirmed: (u.status ?? '').toLowerCase() === 'accepted',
            source: 'connecteam',
          });
        }
      } else {
        for (const id of ids) {
          crew.push({
            id,
            name: userNames.get(id) ?? `Crew ${id}`,
            shiftStart: toIso(shift.startTime),
            shiftEnd: toIso(shift.endTime),
            // Without per-user status we treat an assignment as confirmed;
            // an assigned shift in Connecteam is a real booking.
            confirmed: true,
            source: 'connecteam',
          });
        }
      }
    }

    // Open shifts tell us the job needs more people than are currently on it.
    const openCount = group.shifts.filter((s) => s.isOpenShift).length;

    partials.push({
      system: 'connecteam',
      externalId: String(first.id ?? first.shiftId ?? key),
      lastActivityAt: toIso(first.startTime),
      ref: extractRef(first.title) ?? extractRef(notesText(first.notes)),
      clientName:
        (asString(first.title) ?? 'Untitled shift').replace(/\bRF[-\s]?\d{3,}\b/i, '').trim() ||
        'Untitled shift',
      eventStart: toIso(first.startTime),
      eventEnd: toIso(group.shifts[group.shifts.length - 1]?.endTime ?? first.endTime),
      venue: first.locationData?.address ?? first.locationData?.name,
      crew: crew.length ? crew : undefined,
      crewRequired: crew.length + openCount || undefined,
    });
  }

  return partials;
}
