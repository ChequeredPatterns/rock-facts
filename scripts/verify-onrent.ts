/**
 * On Rent Events API discovery tool.
 *
 * WHY THIS EXISTS: unlike the other connectors, nothing at all is known about
 * the On Rent Events API — not the base URL, the auth header, the endpoint
 * paths, or the field names. This script works it out empirically from a base
 * URL and a key, so the connector can be finished without waiting on vendor
 * documentation that may never arrive.
 *
 * RUN:  npm run verify:onrent
 *
 * NEEDS two environment variables:
 *   ONRENT_API_BASE   e.g. https://api.onrentevents.com
 *   ONRENT_API_KEY    your key
 *
 * SAFETY:
 *  - The key is read from the environment, never a command-line argument,
 *    which would persist in shell history.
 *  - It is never printed, never written to disk, and sent only to the host
 *    given in ONRENT_API_BASE.
 *  - Only response SHAPES are reported — field names, types and detected
 *    date formats. Client names, addresses and money values are NOT printed,
 *    so the output is safe to share.
 */

const BASE = process.env.ONRENT_API_BASE?.replace(/\/$/, '');
const KEY = process.env.ONRENT_API_KEY;

/** Header styles to try, commonest first. */
const AUTH_STYLES: { name: string; headers: (k: string) => Record<string, string> }[] = [
  { name: 'Authorization: Bearer', headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  { name: 'X-API-KEY', headers: (k) => ({ 'X-API-KEY': k }) },
  { name: 'X-Auth-Token', headers: (k) => ({ 'X-Auth-Token': k }) },
  { name: 'api-key', headers: (k) => ({ 'api-key': k }) },
  { name: 'Authorization: raw', headers: (k) => ({ Authorization: k }) },
  {
    name: 'HTTP Basic (key as user)',
    headers: (k) => ({ Authorization: `Basic ${Buffer.from(`${k}:`).toString('base64')}` }),
  },
];

/** Paths a rental/event system plausibly exposes. Cheap to try them all. */
const PATHS = [
  '/quotes',
  '/api/quotes',
  '/api/v1/quotes',
  '/v1/quotes',
  '/opportunities',
  '/api/v1/opportunities',
  '/bookings',
  '/api/v1/bookings',
  '/orders',
  '/api/v1/orders',
  '/jobs',
  '/api/v1/jobs',
  '/events',
  '/api/v1/events',
  '/api/v1/customers',
  '/customers',
  '/me',
  '/api/v1/me',
];

interface Probe {
  status: number;
  json: unknown;
  raw: string;
}

async function probe(url: string, headers: Record<string, string>): Promise<Probe> {
  try {
    const res = await fetch(url, {
      headers: { ...headers, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, raw: raw.slice(0, 200) };
  } catch (err) {
    return { status: 0, json: null, raw: err instanceof Error ? err.message : 'error' };
  }
}

/** Describe a value's type, flagging anything that looks like a date or money. */
function typeOf(key: string, v: unknown): string {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'string') {
    const s = v as string;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'string — ISO DATE';
    if (/^\d+(\.\d+)?$/.test(s) && /total|price|amount|cost|value/i.test(key))
      return 'string — MONEY';
    return 'string';
  }
  if (t === 'number') {
    const n = v as number;
    if (/time|date|start|end|created|updated/i.test(key)) {
      if (n > 1e11) return `number — MILLIseconds (${new Date(n).toISOString()})`;
      if (n > 1e8) return `number — SECONDS (${new Date(n * 1000).toISOString()})`;
    }
    if (/total|price|amount|cost|value/i.test(key)) return 'number — MONEY';
    return 'number';
  }
  return t;
}

/** Print field names and types only — never the values. */
function shape(value: unknown, depth = 0): string {
  const pad = '  '.repeat(depth + 1);
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array (empty)';
    return `array[${value.length}] of:${shape(value[0], depth + 1)}`;
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) =>
        v !== null && typeof v === 'object'
          ? `\n${pad}${k}: ${shape(v, depth + 1)}`
          : `\n${pad}${k}: ${typeOf(k, v)}`,
      )
      .join('');
  }
  return typeof value;
}

async function main() {
  console.log('\n=== On Rent Events API discovery ===\n');

  if (!BASE || !KEY) {
    console.error('Missing configuration. Both of these must be set:\n');
    console.error('  ONRENT_API_BASE   e.g. https://api.onrentevents.com');
    console.error('  ONRENT_API_KEY    your key\n');
    console.error('Set them as environment variables — not on the command line,');
    console.error('which would leave the key in your shell history.\n');
    console.error('If you do not know the base URL yet, that is the one thing');
    console.error('On Rent Events support has to tell you.\n');
    process.exit(1);
  }

  console.log(`Base URL: ${BASE}`);
  console.log(`API key: present (${KEY.length} characters, not printed)\n`);

  // --- Step 1: is the host even reachable? --------------------------------
  const reach = await probe(BASE, {});
  if (reach.status === 0) {
    console.error(`Cannot reach ${BASE}.`);
    console.error(`Reason: ${reach.raw}\n`);
    console.error('If running in a cloud session, add that host to the');
    console.error("environment's Allowed domains, then start a new session.\n");
    process.exit(2);
  }
  console.log(`Host reachable (HTTP ${reach.status}).\n`);

  // --- Step 2: find a working auth style + path ---------------------------
  console.log('Probing endpoints (this takes a moment)...\n');
  const hits: { path: string; style: string; probe: Probe }[] = [];

  for (const path of PATHS) {
    for (const style of AUTH_STYLES) {
      const r = await probe(`${BASE}${path}`, style.headers(KEY));

      // 404 means wrong path; 401/403 means right path, wrong auth. Both are
      // informative, but only 2xx is a hit.
      if (r.status >= 200 && r.status < 300) {
        console.log(`  HIT  ${r.status}  ${path.padEnd(26)} via ${style.name}`);
        hits.push({ path, style: style.name, probe: r });
        break; // this path works; no need to try other auth styles on it
      }
      if (r.status === 401 || r.status === 403) {
        // Path likely exists but auth is wrong — worth reporting once.
        if (style === AUTH_STYLES[AUTH_STYLES.length - 1]) {
          console.log(`  auth ${r.status}  ${path.padEnd(26)} exists, but no auth style worked`);
        }
        continue;
      }
    }
  }

  if (hits.length === 0) {
    console.error('\nNo endpoint responded successfully.\n');
    console.error('Most likely one of:');
    console.error('  - the base URL is wrong (it is often company-specific,');
    console.error('    e.g. https://yourcompany.onrentevents.com/api)');
    console.error('  - the key needs a different header than the six tried');
    console.error('  - the paths differ from the common patterns tried\n');
    console.error('Ask On Rent Events support for: the base URL, the auth header,');
    console.error('and the path that lists quotes. That is all that is missing.\n');
    process.exit(3);
  }

  // --- Step 3: report the shapes ------------------------------------------
  console.log(`\n${hits.length} working endpoint(s) found.\n`);
  for (const hit of hits) {
    console.log(`--- ${hit.path}  (auth: ${hit.style}) ---`);
    console.log(shape(hit.probe.json));
    console.log('');
  }

  console.log('=== Done. Paste this output back and the connector can be finished. ===');
  console.log('(Field names and types only — no client names, addresses or amounts.)\n');
}

main().catch((e) => {
  console.error('Discovery failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

// Marks this file as a module so its top-level names are scoped to it,
// rather than colliding with the other verifier script.
export {};
