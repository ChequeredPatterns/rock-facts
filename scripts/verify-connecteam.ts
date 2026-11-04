/**
 * Connecteam connector verifier.
 *
 * WHY THIS EXISTS: the Connecteam connector was written without access to
 * Connecteam's API documentation, so its base URL, auth header, endpoint
 * paths and timestamp units are all unconfirmed. This script probes the live
 * API with a real key and reports what is actually true, so the guesses in
 * `src/lib/connectors/connecteam.ts` can be replaced with facts.
 *
 * RUN:  npm run verify:connecteam
 *
 * SAFETY:
 *  - The API key is read from the environment. It is never printed, never
 *    written to a file, and never sent anywhere except Connecteam.
 *  - Only the SHAPE of responses is reported — field names, types and
 *    timestamp units. Staff names, client names and other record values are
 *    not printed, so the output is safe to paste into a chat or an issue.
 */

const KEY = process.env.CONNECTEAM_API_KEY;

/** Candidate auth schemes, since the correct header is unconfirmed. */
const AUTH_STYLES: { name: string; headers: (k: string) => Record<string, string> }[] = [
  { name: 'X-API-KEY header', headers: (k) => ({ 'X-API-KEY': k }) },
  { name: 'Authorization: Bearer', headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  { name: 'Authorization: raw key', headers: (k) => ({ Authorization: k }) },
  { name: 'x-api-key (lowercase)', headers: (k) => ({ 'x-api-key': k }) },
];

const BASES = ['https://api.connecteam.com'];
const SCHEDULER_PATHS = ['/scheduler/v1/schedulers', '/scheduler/v2/schedulers'];
const USER_PATHS = ['/users/v1/users'];

function describe(value: unknown, depth = 0): string {
  const pad = '  '.repeat(depth);
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array (empty)';
    return `array[${value.length}] of:\n${pad}  ${describe(value[0], depth + 1)}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries
      .map(([k, v]) => {
        if (v !== null && typeof v === 'object') {
          return `\n${pad}  ${k}: ${describe(v, depth + 1)}`;
        }
        return `\n${pad}  ${k}: ${typeOf(k, v)}`;
      })
      .join('');
  }
  return typeof value;
}

/** Report a value's type, and for anything time-shaped, its likely unit. */
function typeOf(key: string, v: unknown): string {
  const t = typeof v;
  if (t === 'number' && /time|date|start|end|created|updated|stamp/i.test(key)) {
    const n = v as number;
    if (n > 1e17) return 'number — NANOseconds?';
    if (n > 1e14) return 'number — MICROseconds?';
    if (n > 1e11) return `number — MILLIseconds (${new Date(n).toISOString()})`;
    if (n > 1e8) return `number — SECONDS (${new Date(n * 1000).toISOString()})`;
    return 'number (too small to be a timestamp)';
  }
  if (t === 'string' && /time|date|start|end/i.test(key)) {
    const d = new Date(v as string);
    return Number.isNaN(d.getTime()) ? 'string' : 'string — ISO date';
  }
  return t;
}

async function probe(url: string, headers: Record<string, string>) {
  try {
    const res = await fetch(url, { headers: { ...headers, Accept: 'application/json' } });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, raw: text.slice(0, 300) };
  } catch (err) {
    return { status: 0, json: null, raw: err instanceof Error ? err.message : 'network error' };
  }
}

async function main() {
  console.log('\n=== Connecteam connector verification ===\n');

  if (!KEY) {
    console.error('CONNECTEAM_API_KEY is not set in the environment.\n');
    console.error('Add it as an environment secret (see README), then re-run.');
    console.error('Do NOT pass it on the command line — it would land in your shell history.\n');
    process.exit(1);
  }
  console.log(`API key found (${KEY.length} characters). It will not be printed.\n`);

  // --- Step 1: reachability ------------------------------------------------
  const reach = await probe(`${BASES[0]}/`, {});
  if (reach.status === 0) {
    console.error(`Cannot reach ${BASES[0]} from this machine.`);
    console.error(`Reason: ${reach.raw}`);
    console.error(
      '\nIf you are running inside the cloud session, add api.connecteam.com to the\n' +
        "environment's Allowed domains under Network access, then start a new session.\n",
    );
    process.exit(2);
  }
  console.log(`Host reachable (HTTP ${reach.status} on /).\n`);

  // --- Step 2: which auth scheme works? ------------------------------------
  let working: { style: string; headers: Record<string, string>; path: string } | null = null;

  for (const base of BASES) {
    for (const path of SCHEDULER_PATHS) {
      for (const style of AUTH_STYLES) {
        const headers = style.headers(KEY);
        const r = await probe(`${base}${path}`, headers);
        const mark = r.status === 200 ? 'OK  ' : '    ';
        console.log(`${mark}${r.status.toString().padStart(3)}  ${style.name.padEnd(24)} ${path}`);
        if (r.status === 200 && !working) {
          working = { style: style.name, headers, path: `${base}${path}` };
        }
      }
    }
  }

  if (!working) {
    console.error('\nNo combination returned 200.');
    console.error('If every attempt returned 401/403, the key may be invalid, or the');
    console.error('Connecteam plan may not include API access. If they returned 404, the');
    console.error('endpoint paths are wrong and need checking against their docs.\n');
    process.exit(3);
  }

  console.log(`\n--- WORKING: ${working.style} on ${working.path} ---\n`);

  // --- Step 3: report the real response shapes -----------------------------
  const schedulers = await probe(working.path, working.headers);
  console.log('SCHEDULERS response shape:');
  console.log(describe(schedulers.json), '\n');

  // Pull a scheduler id so shifts can be probed, without printing names.
  const payload = schedulers.json as Record<string, unknown> | null;
  const list =
    ((payload?.data as Record<string, unknown>)?.schedulers as Record<string, unknown>[]) ??
    (payload?.schedulers as Record<string, unknown>[]) ??
    (Array.isArray(payload) ? (payload as Record<string, unknown>[]) : []);

  const schedulerId = list[0]?.id ?? list[0]?.schedulerId;
  if (schedulerId) {
    console.log(`Found scheduler id: ${schedulerId}`);
    console.log('   → this is the value for CONNECTEAM_SCHEDULER_ID\n');

    const now = Math.floor(Date.now() / 1000);
    const shiftUrl =
      `${BASES[0]}/scheduler/v1/schedulers/${schedulerId}/shifts` +
      `?startTime=${now - 30 * 86400}&endTime=${now + 90 * 86400}&limit=5`;
    const shifts = await probe(shiftUrl, working.headers);
    console.log(`SHIFTS response (HTTP ${shifts.status}) shape:`);
    console.log(describe(shifts.json), '\n');
    if (shifts.status !== 200) console.log('Raw:', shifts.raw, '\n');
  } else {
    console.log('No scheduler id found in the response — check the shape above.\n');
  }

  for (const p of USER_PATHS) {
    const users = await probe(`${BASES[0]}${p}?limit=3`, working.headers);
    console.log(`USERS ${p} (HTTP ${users.status}) shape:`);
    console.log(describe(users.json), '\n');
  }

  console.log('=== Done. Paste this output back and the connector can be corrected. ===');
  console.log('(It contains field names and types only — no names or personal data.)\n');
}

main().catch((e) => {
  console.error('Verifier failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

// Marks this file as a module so its top-level names are scoped to it,
// rather than colliding with the other verifier script.
export {};
