/**
 * On Rent Events / Current RMS API verifier.
 *
 * On Rent Events runs on Current RMS, so this targets that API directly.
 * It confirms the credentials work, reports the real response shape, and
 * — importantly — lists the opportunity status names actually in use, which
 * is what the connector's status mapping has to match.
 *
 * RUN:  npm run verify:onrent
 *
 * NEEDS:
 *   ONRENT_SUBDOMAIN  first part of your Current RMS web address
 *   ONRENT_API_KEY    System Setup → Integrations → API
 *
 * SAFETY:
 *  - Credentials are read from the environment, never command-line arguments
 *    that would persist in shell history, and are never printed.
 *  - Only field NAMES, types and status labels are reported. Client names,
 *    addresses, email addresses and money values are not printed, so the
 *    output is safe to share.
 */

const SUBDOMAIN = process.env.ONRENT_SUBDOMAIN;
const KEY = process.env.ONRENT_API_KEY;
const BASE = process.env.ONRENT_API_BASE?.replace(/\/$/, '') ?? 'https://api.current-rms.com/api/v1';

/** The documented scheme first, then fallbacks in case it differs. */
const AUTH_STYLES: { name: string; headers: Record<string, string> }[] = [];

function buildAuthStyles(sub: string, key: string) {
  AUTH_STYLES.push(
    { name: 'X-SUBDOMAIN + X-AUTH-TOKEN', headers: { 'X-SUBDOMAIN': sub, 'X-AUTH-TOKEN': key } },
    { name: 'X-SUBDOMAIN + Authorization Bearer', headers: { 'X-SUBDOMAIN': sub, Authorization: `Bearer ${key}` } },
    { name: 'X-AUTH-TOKEN only', headers: { 'X-AUTH-TOKEN': key } },
    { name: 'Authorization Bearer only', headers: { Authorization: `Bearer ${key}` } },
  );
}

interface Probe {
  status: number;
  json: unknown;
  raw: string;
}

async function probe(url: string, headers: Record<string, string>): Promise<Probe> {
  try {
    const res = await fetch(url, {
      headers: { ...headers, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, raw: raw.slice(0, 220) };
  } catch (err) {
    return { status: 0, json: null, raw: err instanceof Error ? err.message : 'error' };
  }
}

/** Field name and type only — never the value. */
function typeOf(key: string, v: unknown): string {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'string') {
    const s = v as string;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'string — ISO DATE';
    if (/^-?\d+(\.\d+)?$/.test(s)) return 'string — NUMERIC (money?)';
    return 'string';
  }
  if (t === 'number' && /time|date|start|end|created|updated/i.test(key)) {
    const n = v as number;
    if (n > 1e11) return `number — MILLIseconds`;
    if (n > 1e8) return `number — SECONDS`;
  }
  return t;
}

function shape(value: unknown, depth = 0): string {
  const pad = '  '.repeat(depth + 1);
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array (empty)';
    return `array[${value.length}] of:${shape(value[0], depth + 1)}`;
  }
  if (typeof value === 'object') {
    if (depth > 3) return '{…}';
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
  console.log('\n=== On Rent Events / Current RMS verification ===\n');

  if (!SUBDOMAIN || !KEY) {
    console.error('Missing configuration. Both of these must be set:\n');
    console.error('  ONRENT_SUBDOMAIN  first part of your Current RMS web address');
    console.error('                    (https://XXXX.current-rms.com → XXXX)');
    console.error('  ONRENT_API_KEY    Current RMS → System Setup → Integrations → API\n');
    console.error('Set them as environment variables, not on the command line.\n');
    process.exit(1);
  }

  buildAuthStyles(SUBDOMAIN, KEY);
  console.log(`Base URL:  ${BASE}`);
  console.log(`Subdomain: ${SUBDOMAIN}`);
  console.log(`API key:   present (${KEY.length} characters, not printed)\n`);

  // --- Step 1: reachability -----------------------------------------------
  const reach = await probe(`${BASE}/opportunities?per_page=1`, {});
  if (reach.status === 0) {
    console.error(`Cannot reach ${BASE}.`);
    console.error(`Reason: ${reach.raw}\n`);
    console.error('In a cloud session, add api.current-rms.com to the environment\'s');
    console.error('Allowed domains under Network access, then start a new session.\n');
    process.exit(2);
  }
  console.log(`Host reachable (HTTP ${reach.status} without credentials, as expected).\n`);

  // --- Step 2: which auth scheme works? -----------------------------------
  let working: { name: string; headers: Record<string, string> } | null = null;
  for (const style of AUTH_STYLES) {
    const r = await probe(`${BASE}/opportunities?per_page=1`, style.headers);
    const mark = r.status === 200 ? 'OK  ' : '    ';
    console.log(`${mark}${String(r.status).padStart(3)}  ${style.name}`);
    if (r.status === 200 && !working) working = style;
  }

  if (!working) {
    console.error('\nNo auth style returned 200.');
    console.error('401/403 everywhere means the key or subdomain is wrong.');
    console.error('404 everywhere means the base URL is wrong — ask On Rent Events');
    console.error('whether your account uses a different API host.\n');
    process.exit(3);
  }

  console.log(`\n--- WORKING: ${working.name} ---\n`);

  // --- Step 3: real response shape ----------------------------------------
  const sample = await probe(`${BASE}/opportunities?per_page=3`, working.headers);
  console.log('OPPORTUNITIES response shape:');
  console.log(shape(sample.json), '\n');

  // --- Step 4: the status names actually in use ---------------------------
  // This is what the connector's status mapping must match, and it is the
  // most likely thing to be wrong, because every business names its own.
  const payload = sample.json as { opportunities?: Record<string, unknown>[] } | null;
  const rows = payload?.opportunities ?? [];
  const statuses = new Set<string>();
  for (const r of rows) {
    for (const field of ['status_name', 'state_name', 'status', 'state']) {
      const v = r[field];
      if (typeof v === 'string') statuses.add(`${field}="${v}"`);
      else if (typeof v === 'number') statuses.add(`${field}=${v}`);
    }
  }
  console.log('STATUS values seen in this sample:');
  console.log(statuses.size ? '  ' + [...statuses].join('\n  ') : '  (none found)');
  console.log(
    '\nThese must match mapOnRentStatus() in src/lib/connectors/onrent.ts.\n' +
      'A larger sample gives a fuller picture — raise per_page if needed.\n',
  );

  // --- Step 5: does date filtering work? ----------------------------------
  const from = new Date(Date.now() - 30 * 86400_000).toISOString();
  const to = new Date(Date.now() + 120 * 86400_000).toISOString();
  const filtered = await probe(
    `${BASE}/opportunities?q[starts_at_gteq]=${encodeURIComponent(from)}` +
      `&q[starts_at_lteq]=${encodeURIComponent(to)}&per_page=1`,
    working.headers,
  );
  console.log(
    `DATE FILTER (q[starts_at_gteq]): HTTP ${filtered.status}` +
      (filtered.status === 200
        ? ' — works.'
        : ' — NOT working; the connector would need to filter in code instead.'),
  );

  console.log('\n=== Done. Paste this output back and the connector can be confirmed. ===');
  console.log('(Field names, types and status labels only — no client data.)\n');
}

main().catch((e) => {
  console.error('Verification failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

// Marks this file as a module so its top-level names are scoped to it,
// rather than colliding with the other verifier script.
export {};
