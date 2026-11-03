/**
 * On Rent Events connector — quotes and their values.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ SPEC STATUS: UNKNOWN — the least certain connector in this project.     │
 * │                                                                         │
 * │ onrentevents.com was unreachable from the build environment. Search     │
 * │ indicated the vendor's help centre advertises "an open API" for pulling │
 * │ data out of your account, but NONE of the following could be            │
 * │ established: base URL, authentication scheme, endpoint paths, response  │
 * │ shapes, or rate limits.                                                 │
 * │                                                                         │
 * │ Rather than invent an API and have it fail confusingly in production,   │
 * │ this connector refuses to run until `ONRENT_API_BASE` is set, and       │
 * │ reports clearly on the setup page that it needs configuring.            │
 * │                                                                         │
 * │ TO FINISH THIS CONNECTOR you need, from On Rent Events support:         │
 * │   • The API base URL (likely tenant-specific, e.g. {company}.onrent...) │
 * │   • How to authenticate (API key header? bearer token? Which header?)   │
 * │   • The endpoint listing quotes/opportunities, with its date filter     │
 * │   • Which response fields carry: client name, client email, event date, │
 * │     quote total, and quote status                                       │
 * │ Send those to this project and the mapping below becomes a 20-line job. │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type { JobStatus } from '../domain';
import { extractRef } from '../matcher';
import type { PartialJob } from '../matcher';

export const SPEC_CONFIRMED = false;

/**
 * Field mapping from an On Rent quote object to our model. Expressed as
 * configurable paths so the connector can be pointed at the real response
 * shape without rewriting the fetch logic — set these once the real payload
 * is known.
 */
export const FIELD_MAP = {
  id: ['id', 'quote_id', 'number'],
  ref: ['number', 'quote_number', 'reference'],
  clientName: ['customer_name', 'client_name', 'customer.name', 'client.name'],
  clientEmail: ['customer_email', 'client_email', 'customer.email', 'client.email'],
  clientPhone: ['customer_phone', 'client_phone', 'customer.phone'],
  eventStart: ['event_start', 'start_date', 'delivery_date', 'starts_at'],
  eventEnd: ['event_end', 'end_date', 'return_date', 'ends_at'],
  venue: ['venue', 'delivery_address', 'location', 'site_address'],
  total: ['total', 'grand_total', 'total_inc_tax', 'amount'],
  status: ['status', 'state', 'stage'],
} as const;

/** Read a dotted path out of an unknown object, safely. */
function readPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** Try each candidate path in order, returning the first value present. */
function firstOf(obj: unknown, paths: readonly string[]): unknown {
  for (const p of paths) {
    const v = readPath(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asIso(v: unknown): string | undefined {
  const s = asString(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function mapOnRentStatus(raw: string | undefined): JobStatus | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (/reject|declin|lost|cancel|void/.test(s)) return 'not_accepted';
  if (/complet|returned|closed|invoiced/.test(s)) return 'completed';
  if (/confirm|accept|booked|order|won/.test(s)) return 'accepted';
  if (/quot|proposal|estimate|draft|pending/.test(s)) return 'quoted';
  return undefined;
}

export class OnRentNotConfiguredError extends Error {
  constructor() {
    super(
      'On Rent Events is not configured. Its API details could not be confirmed during the build — ' +
        'see src/lib/connectors/onrent.ts for exactly what to request from On Rent Events support.',
    );
    this.name = 'OnRentNotConfiguredError';
  }
}

export async function fetchOnRentJobs(from: Date, to: Date): Promise<PartialJob[]> {
  const base = process.env.ONRENT_API_BASE;
  const apiKey = process.env.ONRENT_API_KEY;
  const path = process.env.ONRENT_QUOTES_PATH ?? '/quotes';

  // Deliberate hard stop: better an honest "not set up" than a silent wrong answer.
  if (!base || !apiKey) throw new OnRentNotConfiguredError();

  const authHeader = process.env.ONRENT_AUTH_HEADER ?? 'Authorization';
  const authValue = process.env.ONRENT_AUTH_PREFIX
    ? `${process.env.ONRENT_AUTH_PREFIX} ${apiKey}`
    : `Bearer ${apiKey}`;

  const params = new URLSearchParams({
    [process.env.ONRENT_FROM_PARAM ?? 'from']: from.toISOString().slice(0, 10),
    [process.env.ONRENT_TO_PARAM ?? 'to']: to.toISOString().slice(0, 10),
  });

  const res = await fetch(`${base.replace(/\/$/, '')}${path}?${params}`, {
    headers: { [authHeader]: authValue, Accept: 'application/json' },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `On Rent Events request failed (${res.status}). The API shape is unconfirmed — ` +
        `check ONRENT_* settings against the real API. ${body.slice(0, 200)}`,
    );
  }

  const json: unknown = await res.json();
  // Accept either a bare array or a wrapped collection.
  const rows: unknown[] = Array.isArray(json)
    ? json
    : ((json as Record<string, unknown>)?.data as unknown[]) ??
      ((json as Record<string, unknown>)?.quotes as unknown[]) ??
      ((json as Record<string, unknown>)?.results as unknown[]) ??
      [];

  return rows.map((row, i) => {
    const id = asString(firstOf(row, FIELD_MAP.id)) ?? `row-${i}`;
    const name = asString(firstOf(row, FIELD_MAP.clientName)) ?? 'Unknown client';
    return {
      system: 'onrent' as const,
      externalId: id,
      lastActivityAt: undefined,
      ref: asString(firstOf(row, FIELD_MAP.ref))
        ? `RF-${asString(firstOf(row, FIELD_MAP.ref))!.replace(/\D/g, '')}`
        : extractRef(name),
      clientName: name,
      clientEmail: asString(firstOf(row, FIELD_MAP.clientEmail)),
      clientPhone: asString(firstOf(row, FIELD_MAP.clientPhone)),
      eventStart: asIso(firstOf(row, FIELD_MAP.eventStart)),
      eventEnd: asIso(firstOf(row, FIELD_MAP.eventEnd)),
      venue: asString(firstOf(row, FIELD_MAP.venue)),
      quoteTotal: asNumber(firstOf(row, FIELD_MAP.total)),
      status: mapOnRentStatus(asString(firstOf(row, FIELD_MAP.status))),
    } satisfies PartialJob;
  });
}
