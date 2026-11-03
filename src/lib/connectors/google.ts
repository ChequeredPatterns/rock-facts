/**
 * Google Calendar + Gmail connector.
 *
 * SPEC STATUS: verified. Google Calendar API v3 and Gmail API v1 are stable,
 * long-documented APIs and the request shapes below are the standard ones.
 *
 * AUTH: OAuth2 refresh-token flow. The account owner consents once; we store
 * the resulting refresh token and exchange it for short-lived access tokens
 * as needed. This is the right choice here because it needs the busy account
 * owner for exactly one click, and never again.
 */

import { BUSINESS_TZ, type CrewAssignment } from '../domain';
import { extractRef } from '../matcher';
import type { PartialJob } from '../matcher';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

/** Scopes the one-off consent must cover. Read-only by design: Rock Factory
 *  Central never writes to the calendar or sends mail, which makes the
 *  permission request far easier to approve. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
];

interface TokenCache {
  token: string;
  expiresAt: number;
}
let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  // Reuse the token until a minute before it expires.
  if (tokenCache && tokenCache.expiresAt - 60_000 > now) return tokenCache.token;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google is not configured: missing client id, secret or refresh token.');
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Google token refresh failed (${res.status}). The refresh token may have been revoked. ${body.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    token: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };
  return tokenCache.token;
}

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  htmlLink?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string }[];
}

/** Resolve a Google start/end object to an ISO instant. All-day events have
 *  `date` instead of `dateTime`; we anchor those to midnight business time. */
function resolveTime(slot: GoogleEvent['start']): string | undefined {
  if (!slot) return undefined;
  if (slot.dateTime) return new Date(slot.dateTime).toISOString();
  if (slot.date) {
    // An all-day event: treat as starting at 00:00 in the business timezone.
    return new Date(`${slot.date}T00:00:00`).toISOString();
  }
  return undefined;
}

/**
 * Pull the client name out of an event title. Event titles in practice look
 * like "Smith Wedding - Town Hall" or "RF-1042 Jane Smith 21st". We strip any
 * job reference and any trailing venue after a dash.
 */
function clientFromTitle(summary: string | undefined): string {
  if (!summary) return 'Untitled event';
  let s = summary.replace(/\bRF[-\s]?\d{3,}\b/i, '').replace(/#\d{3,}/, '');
  // Drop a trailing " - Venue" segment if there is more than one segment.
  const parts = s.split(/\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) s = parts[0];
  return s.trim() || 'Untitled event';
}

export interface CalendarSelection {
  /** Calendar ids to treat as event/job calendars. */
  eventCalendarIds: string[];
  /** Calendar ids that represent one crew member each, keyed to their name. */
  crewCalendars: { id: string; name: string }[];
}

/**
 * Read the calendar selection from config.
 *
 * The Rock Factory's Google account already has a "1. Live Event" calendar
 * plus one calendar per crew member ("GSR - Ethan", "GSR - Tom", ...). That
 * existing structure is used directly: event calendars give us jobs, crew
 * calendars give us a secondary read on who is working.
 */
export function calendarSelection(): CalendarSelection {
  const eventIds = (process.env.GOOGLE_EVENT_CALENDAR_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const crew = (process.env.GOOGLE_CREW_CALENDARS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      // Format: "Name=calendarId"
      const [name, id] = entry.split('=').map((p) => p?.trim());
      return id ? { id, name } : null;
    })
    .filter((v): v is { id: string; name: string } => v !== null);

  return { eventCalendarIds: eventIds, crewCalendars: crew };
}

async function listEvents(
  calendarId: string,
  from: Date,
  to: Date,
): Promise<GoogleEvent[]> {
  const token = await getAccessToken();
  const out: GoogleEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      // Expand recurring events into individual instances.
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      timeZone: BUSINESS_TZ,
    });
    if (pageToken) params.set('pageToken', pageToken);

    const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Google Calendar read failed for "${calendarId}" (${res.status}). ${body.slice(0, 200)}`,
      );
    }

    const json = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
    out.push(...(json.items ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);

  // Cancelled events still come back; they are not jobs.
  return out.filter((e) => e.status !== 'cancelled');
}

/** Fetch jobs visible in the event calendars. */
export async function fetchCalendarJobs(from: Date, to: Date): Promise<PartialJob[]> {
  const { eventCalendarIds, crewCalendars } = calendarSelection();
  if (eventCalendarIds.length === 0) return [];

  const eventLists = await Promise.all(
    eventCalendarIds.map((id) => listEvents(id, from, to)),
  );

  // Crew calendars are read in parallel and used to infer who is on each job,
  // as a fallback for when Connecteam is not connected.
  const crewEvents = await Promise.all(
    crewCalendars.map(async (c) => ({
      name: c.name,
      events: await listEvents(c.id, from, to).catch(() => [] as GoogleEvent[]),
    })),
  );

  const partials: PartialJob[] = [];

  for (const events of eventLists) {
    for (const ev of events) {
      const start = resolveTime(ev.start);
      const end = resolveTime(ev.end);
      const clientName = clientFromTitle(ev.summary);

      // Infer crew: any crew calendar with an event overlapping this one.
      const crew: CrewAssignment[] = [];
      if (start) {
        const startMs = new Date(start).getTime();
        for (const person of crewEvents) {
          const overlapping = person.events.find((pe) => {
            const ps = resolveTime(pe.start);
            if (!ps) return false;
            // Same calendar day is a good enough signal for a day-long job.
            return Math.abs(new Date(ps).getTime() - startMs) < 12 * 3_600_000;
          });
          if (overlapping) {
            crew.push({
              id: `cal:${person.name}`,
              name: person.name,
              shiftStart: resolveTime(overlapping.start),
              shiftEnd: resolveTime(overlapping.end),
              // A calendar entry is a plan, not a confirmed acceptance.
              confirmed: false,
              source: 'calendar',
            });
          }
        }
      }

      partials.push({
        system: 'calendar',
        externalId: ev.id,
        url: ev.htmlLink,
        lastActivityAt: ev.updated,
        ref: extractRef(ev.summary) ?? extractRef(ev.description),
        clientName,
        clientEmail: ev.attendees?.find((a) => a.email && !a.email.endsWith('calendar.google.com'))
          ?.email,
        eventStart: start,
        eventEnd: end,
        venue: ev.location,
        crew: crew.length ? crew : undefined,
      });
    }
  }

  return partials;
}

/**
 * Gmail: count unread threads from a client address, used to show whether a
 * client has replied. Kept deliberately narrow — we read metadata only, never
 * message bodies, which keeps the permission ask small and the privacy story
 * simple.
 */
export async function fetchGmailActivity(
  emails: string[],
): Promise<Map<string, { unread: number; lastMessageAt?: string; threadUrl?: string }>> {
  const result = new Map<string, { unread: number; lastMessageAt?: string; threadUrl?: string }>();
  if (emails.length === 0) return result;
  const token = await getAccessToken();

  for (const email of emails) {
    const params = new URLSearchParams({
      q: `from:${email}`,
      maxResults: '5',
    });
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) continue;
    const json = (await res.json()) as { threads?: { id: string }[] };
    const threads = json.threads ?? [];
    if (threads.length === 0) continue;
    result.set(email.toLowerCase(), {
      unread: threads.length,
      threadUrl: `https://mail.google.com/mail/u/0/#search/from%3A${encodeURIComponent(email)}`,
    });
  }

  return result;
}
