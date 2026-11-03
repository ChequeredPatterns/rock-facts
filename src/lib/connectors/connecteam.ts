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
  notes?: string;
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

export async function verifyConnecteam(): Promise<{ ok: true; detail: string }> {
  const data = await ctGet<{ data?: { schedulers?: { id?: string; name?: string }[] } }>(
    API_SPEC.endpoints.schedulers,
  );
  const schedulers = data?.data?.schedulers ?? [];
  return {
    ok: true,
    detail:
      schedulers.length > 0
        ? `Connected. Schedulers found: ${schedulers.map((s) => s.name ?? s.id).join(', ')}`
        : 'Connected, but no schedulers were returned.',
  };
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

  const [shiftPayload, userPayload] = await Promise.all([
    ctGet<{ data?: { shifts?: ConnecteamShift[] } }>(API_SPEC.endpoints.shifts(schedulerId), {
      startTime: String(Math.floor(from.getTime() / 1000)),
      endTime: String(Math.floor(to.getTime() / 1000)),
      limit: '500',
    }),
    ctGet<{ data?: { users?: ConnecteamUser[] } }>(API_SPEC.endpoints.users, {
      limit: '500',
    }).catch(() => ({ data: { users: [] as ConnecteamUser[] } })),
  ]);

  const userNames = new Map<string, string>();
  for (const u of userPayload?.data?.users ?? []) {
    const id = String(u.userId ?? u.id ?? '');
    if (id) userNames.set(id, [u.firstName, u.lastName].filter(Boolean).join(' ') || id);
  }

  const shifts = shiftPayload?.data?.shifts ?? [];

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
      ref: extractRef(first.title) ?? extractRef(first.notes),
      clientName: (first.title ?? 'Untitled shift').replace(/\bRF[-\s]?\d{3,}\b/i, '').trim(),
      eventStart: toIso(first.startTime),
      eventEnd: toIso(group.shifts[group.shifts.length - 1]?.endTime ?? first.endTime),
      venue: first.locationData?.address ?? first.locationData?.name,
      crew: crew.length ? crew : undefined,
      crewRequired: crew.length + openCount || undefined,
    });
  }

  return partials;
}
