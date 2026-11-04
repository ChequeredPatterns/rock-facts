/**
 * On Rent Events connector — quotes and their values.
 *
 * On Rent Events runs on **Current RMS**, so this targets the documented
 * Current RMS API rather than guessing at a bespoke one.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ SPEC STATUS: CONFIRMED against the live account (therockfactory).       │
 * │                                                                         │
 * │ Checked end to end: the X-SUBDOMAIN / X-AUTH-TOKEN header pair          │
 * │ authenticates, /opportunities returns, the Ransack date filter          │
 * │ q[starts_at_gteq] is accepted, and every field read below is present    │
 * │ on live records. The status mapping was rebuilt from the real state     │
 * │ and status values — see mapOnRentStatus.                                │
 * │                                                                         │
 * │ Re-check at any time with:  npm run verify:onrent                       │
 * │                                                                         │
 * │ KNOWN RISK — API VERSION. A v2.1 of the Opportunities API was reported  │
 * │ released in June 2026, keeping the same URL and query parameters but    │
 * │ changing the response shape, and no longer returning line items or      │
 * │ participants on the list endpoint. Which version an account receives is │
 * │ unconfirmed, so every field below is read defensively and the connector │
 * │ tolerates either shape rather than assuming one.                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type { JobStatus } from '../domain';
import { extractRef } from '../matcher';
import type { PartialJob } from '../matcher';

/** ⚠ Verify against https://api.current-rms.com/doc when reachable. */
export const API_SPEC = {
  baseUrl: 'https://api.current-rms.com/api/v1',
  /**
   * Current RMS identifies the account by subdomain and authenticates with a
   * token, both sent as headers. The key is generated in Current RMS under
   * System Setup → Integrations → API.
   *
   * NOTE: a Current RMS API key grants full READ AND WRITE access to the
   * system — it cannot be scoped to read-only. This connector only ever
   * issues GET requests, but the key itself is powerful, so it belongs in an
   * environment secret and nowhere else.
   */
  auth: (subdomain: string, token: string) => ({
    'X-SUBDOMAIN': subdomain,
    'X-AUTH-TOKEN': token,
  }),
  endpoints: {
    opportunities: '/opportunities',
    members: '/members',
  },
  /** Current RMS uses Ransack-style filters, e.g. q[starts_at_gteq]. */
  filters: {
    startsAfter: 'q[starts_at_gteq]',
    startsBefore: 'q[starts_at_lteq]',
  },
  pagination: { page: 'page', perPage: 'per_page', maxPerPage: 100 },
} as const;

export const SPEC_CONFIRMED = true;

/**
 * Map a Current RMS opportunity to our pipeline status.
 *
 * Current RMS carries TWO independent fields, and the distinction matters:
 *
 *   state  — the lifecycle: Draft → Quotation → Order. Authoritative.
 *   status — a sub-status within that state: Open, Provisional, Active.
 *
 * Verified against the live account, where all 50 opportunities were one of:
 *
 *   Quotation / Provisional   (29)
 *   Order     / Open          (15)
 *   Draft     / Open           (3)
 *   Order     / Active         (3)
 *
 * An earlier version read `status_name` alone and fell back to `state_name`
 * only when it was absent. Because "Open" matches none of the rules, every
 * Order sitting on Open — 15 of 50, the confirmed work — came back with no
 * status at all, and so never counted as committed for crew or logistics.
 * "Open" is also not a lifecycle signal in its own right: it appears on both
 * Orders and Drafts, which belong at opposite ends of the pipeline.
 *
 * So the state decides, and the sub-status is consulted only when there is no
 * state to go on. Matching is on NAMES, not the numeric codes: the codes are
 * undocumented and differ between API versions, whereas the names are stable.
 * Order of tests matters — "not accepted" contains "accepted", so the negative
 * cases are tested first.
 */
export function mapOnRentStatus(
  statusName: string | undefined,
  stateName?: string | undefined,
): JobStatus | undefined {
  const status = (statusName ?? '').toLowerCase().trim();
  const state = (stateName ?? '').toLowerCase().trim();
  if (!status && !state) return undefined;

  // Terminal outcomes are decisive and can be recorded in either field.
  const either = `${state} ${status}`;
  if (/dead|lost|reject|declin|cancel|void|not\s*accept/.test(either)) return 'not_accepted';
  if (/complet|closed|returned|invoiced|checked\s*in/.test(either)) return 'completed';

  // The lifecycle state wins whenever it is present.
  if (state) {
    if (/order/.test(state)) return 'accepted';
    if (/quot|proposal|estimate/.test(state)) return 'quoted';
    if (/draft|enquir|inquir|lead/.test(state)) return 'new_enquiry';
  }

  // No usable state: fall back to the sub-status. "Open" is deliberately absent
  // here — on its own it says nothing about where the job sits.
  if (/reserv|confirm|accept|won|issued|active/.test(status)) return 'accepted';
  if (/quot|provisional|proposal|estimate|pending/.test(status)) return 'quoted';
  if (/enquir|inquir|lead|new/.test(status)) return 'new_enquiry';
  return undefined;
}

/** A Current RMS opportunity, with every field optional — see version risk. */
interface Opportunity {
  id?: number | string;
  subject?: string;
  number?: number | string;
  description?: string;
  status?: string | number;
  status_name?: string;
  state?: string | number;
  state_name?: string;
  starts_at?: string;
  ends_at?: string;
  deliver_starts_at?: string;
  collect_ends_at?: string;
  charge_total?: string | number;
  charge_total_with_tax?: string | number;
  updated_at?: string;
  created_at?: string;
  member?: { id?: number | string; name?: string; email?: string; phone?: string };
  billing_address?: { name?: string; street?: string; city?: string };
  venue?: { name?: string; address?: { street?: string; city?: string } };
  destination?: { name?: string };
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
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** The sub-status name, whichever shape the response uses. */
function statusText(o: Opportunity): string | undefined {
  if (typeof o.status_name === 'string') return o.status_name;
  if (typeof o.status === 'string') return o.status;
  return undefined;
}

/** The lifecycle state name, whichever shape the response uses. */
function stateText(o: Opportunity): string | undefined {
  if (typeof o.state_name === 'string') return o.state_name;
  if (typeof o.state === 'string') return o.state;
  return undefined;
}

/** Best available venue description. */
function venueText(o: Opportunity): string | undefined {
  const v = o.venue;
  if (v?.name) return v.name;
  if (v?.address?.street || v?.address?.city) {
    return [v.address.street, v.address.city].filter(Boolean).join(', ');
  }
  if (o.destination?.name) return o.destination.name;
  const b = o.billing_address;
  if (b?.street || b?.city) return [b.street, b.city].filter(Boolean).join(', ');
  return undefined;
}

export class OnRentNotConfiguredError extends Error {
  constructor(missing: string) {
    super(
      `On Rent Events is not configured: ${missing} is missing. ` +
        'On Rent Events runs on Current RMS; the API key comes from ' +
        'System Setup → Integrations → API, and the subdomain is the first ' +
        'part of your Current RMS web address.',
    );
    this.name = 'OnRentNotConfiguredError';
  }
}

async function currentRmsGet(path: string, params: URLSearchParams): Promise<unknown> {
  const subdomain = process.env.ONRENT_SUBDOMAIN;
  const token = process.env.ONRENT_API_KEY;
  if (!subdomain) throw new OnRentNotConfiguredError('ONRENT_SUBDOMAIN');
  if (!token) throw new OnRentNotConfiguredError('ONRENT_API_KEY');

  const base = process.env.ONRENT_API_BASE?.replace(/\/$/, '') ?? API_SPEC.baseUrl;
  const res = await fetch(`${base}${path}?${params}`, {
    headers: { ...API_SPEC.auth(subdomain, token), Accept: 'application/json' },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'On Rent Events rejected the credentials. Check the API key is current and ' +
        'that ONRENT_SUBDOMAIN matches your Current RMS web address.',
    );
  }
  if (res.status === 429) {
    throw new Error('On Rent Events rate limit reached. It will recover on its own shortly.');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`On Rent Events request failed (${res.status}). ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Fetch opportunities overlapping the window, following pagination.
 *
 * A page cap is enforced so a misconfigured filter cannot walk an entire
 * account's history on every dashboard load.
 */
export async function fetchOnRentJobs(from: Date, to: Date): Promise<PartialJob[]> {
  const out: PartialJob[] = [];
  const MAX_PAGES = 10;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      [API_SPEC.filters.startsAfter]: from.toISOString(),
      [API_SPEC.filters.startsBefore]: to.toISOString(),
      [API_SPEC.pagination.page]: String(page),
      [API_SPEC.pagination.perPage]: String(API_SPEC.pagination.maxPerPage),
    });

    const json = (await currentRmsGet(API_SPEC.endpoints.opportunities, params)) as
      | { opportunities?: Opportunity[]; meta?: { total_row_count?: number } }
      | Opportunity[];

    const rows: Opportunity[] = Array.isArray(json) ? json : (json?.opportunities ?? []);
    if (rows.length === 0) break;

    for (const o of rows) {
      const id = String(o.id ?? '');
      if (!id) continue;

      const clientName = o.member?.name ?? o.billing_address?.name ?? o.subject ?? 'Unknown client';

      // Current RMS opportunity numbers are the natural job reference. Fall
      // back to anything reference-shaped written into the subject.
      const ref = o.number != null ? `RF-${String(o.number).replace(/\D/g, '')}` : extractRef(o.subject);

      out.push({
        system: 'onrent',
        externalId: id,
        url: process.env.ONRENT_SUBDOMAIN
          ? `https://${process.env.ONRENT_SUBDOMAIN}.current-rms.com/opportunities/${id}`
          : undefined,
        lastActivityAt: asIso(o.updated_at) ?? asIso(o.created_at),
        ref,
        clientName,
        clientEmail: o.member?.email,
        clientPhone: o.member?.phone,
        // Delivery/collection bracket the job more accurately than the
        // charge period when both are present.
        eventStart: asIso(o.deliver_starts_at) ?? asIso(o.starts_at),
        eventEnd: asIso(o.collect_ends_at) ?? asIso(o.ends_at),
        venue: venueText(o),
        // Prefer the tax-inclusive figure: it is what the client actually pays.
        quoteTotal: asNumber(o.charge_total_with_tax) ?? asNumber(o.charge_total),
        status: mapOnRentStatus(statusText(o), stateText(o)),
      });
    }

    if (rows.length < API_SPEC.pagination.maxPerPage) break;
  }

  return out;
}

/** Confirms credentials work, for the Setup page. */
export async function verifyOnRent(): Promise<{ ok: true; detail: string }> {
  const params = new URLSearchParams({ [API_SPEC.pagination.perPage]: '1' });
  const json = (await currentRmsGet(API_SPEC.endpoints.opportunities, params)) as {
    meta?: { total_row_count?: number };
  };
  const total = json?.meta?.total_row_count;
  return {
    ok: true,
    detail: total != null ? `Connected. ${total} opportunities visible.` : 'Connected.',
  };
}
