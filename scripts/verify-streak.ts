/**
 * Streak connector verifier.
 *
 * WHY THIS EXISTS: `src/lib/connectors/streak.ts` was originally written
 * without access to Streak's API docs, so its base URL, auth header, endpoint
 * paths, timestamp units and stage mapping were all guesses. This script
 * checks each of them against the live API and says which are right.
 *
 * It is also the tool that finds your STREAK_PIPELINE_KEY, and it re-checks
 * the stage mapping against your real stage names — so if someone renames a
 * stage in Streak, running this will show you the stage that stopped mapping.
 *
 * RUN:  npm run verify:streak
 *
 * SAFETY:
 *  - The API key is read from the environment. It is never printed, never
 *    written to a file, and never sent anywhere except Streak.
 *  - Client names, email addresses and box contents are NOT printed. Only
 *    field names, types, stage names and counts are reported, so the output
 *    is safe to paste into a chat or an issue.
 */

import {
  API_SPEC,
  mapStageToStatus,
} from '../src/lib/connectors/streak';

const KEY = process.env.STREAK_API_KEY;

/** Both hosts answer; the first is the one Streak documents. */
const HOSTS = ['https://api.streak.com/api/v1', 'https://www.streak.com/api/v1'];

function authHeaders(key: string): Record<string, string> {
  return { ...API_SPEC.auth(key), Accept: 'application/json' };
}

async function probe(url: string, headers: Record<string, string>) {
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, bytes: text.length, raw: text.slice(0, 200) };
  } catch (err) {
    return {
      status: 0,
      json: null,
      bytes: 0,
      raw: err instanceof Error ? err.message : 'network error',
    };
  }
}

/** Describe a timestamp's likely unit, which is the classic way to get this wrong. */
function timestampUnit(n: unknown): string {
  if (typeof n !== 'number') return `${typeof n}`;
  if (n > 1e17) return 'NANOseconds?';
  if (n > 1e14) return 'MICROseconds?';
  if (n > 1e11) return `MILLIseconds (${new Date(n).toISOString()})`;
  if (n > 1e8) return `SECONDS (${new Date(n * 1000).toISOString()})`;
  return 'too small to be a timestamp';
}

async function main() {
  console.log('\n=== Streak connector verification ===\n');

  if (!KEY) {
    console.error('STREAK_API_KEY is not set in the environment.\n');
    console.error('Get it from Gmail -> Streak -> Integrations -> API Key, then add it as');
    console.error('an environment secret (see SETUP.md) and re-run.');
    console.error('Do NOT pass it on the command line — it would land in your shell history.\n');
    process.exit(1);
  }
  console.log(`API key found (${KEY.length} characters). It will not be printed.\n`);

  const headers = authHeaders(KEY);

  // --- Step 1: auth scheme and host --------------------------------------
  console.log('--- 1. Auth scheme and host ---');
  let base = '';
  for (const host of HOSTS) {
    const r = await probe(`${host}${API_SPEC.endpoints.me}`, headers);
    const mark = r.status === 200 ? 'OK ' : '   ';
    console.log(`${mark} ${String(r.status).padStart(3)}  ${host}`);
    if (r.status === 200 && !base) base = host;
  }

  if (!base) {
    console.error('\nNo host accepted the key with HTTP Basic auth (key as username).');
    console.error('If every attempt returned 401, the key may be invalid or revoked, or');
    console.error('the Streak plan may not include API access (it is a paid feature).\n');
    process.exit(2);
  }
  console.log(`\nUsing: ${base}`);
  console.log(
    base === API_SPEC.baseUrl
      ? 'Matches API_SPEC.baseUrl.\n'
      : `WARNING: API_SPEC.baseUrl is ${API_SPEC.baseUrl} — consider updating it.\n`,
  );

  // --- Step 2: the signed-in user ----------------------------------------
  const me = (await probe(`${base}${API_SPEC.endpoints.me}`, headers)).json as Record<
    string,
    unknown
  > | null;
  console.log('--- 2. Signed-in user ---');
  console.log(`Fields returned: ${me ? Object.keys(me).join(', ') : '(none)'}`);
  console.log(`creationTimestamp unit: ${timestampUnit(me?.creationTimestamp)}\n`);

  // --- Step 3: pipelines, and the key you need ---------------------------
  console.log('--- 3. Pipelines (this is where STREAK_PIPELINE_KEY comes from) ---');
  const pipesRes = await probe(`${base}${API_SPEC.endpoints.pipelines}`, headers);
  const pipes = (Array.isArray(pipesRes.json) ? pipesRes.json : []) as Record<string, unknown>[];
  if (pipes.length === 0) {
    console.error(`No pipelines returned (HTTP ${pipesRes.status}). ${pipesRes.raw}\n`);
    process.exit(3);
  }
  for (const p of pipes) {
    const key = (p.pipelineKey ?? p.key) as string | undefined;
    console.log(`  ${String(p.name)}`);
    console.log(`    STREAK_PIPELINE_KEY=${key}`);
  }
  console.log('');

  // Verify the pipeline we are actually configured for, else the first one.
  const configured = process.env.STREAK_PIPELINE_KEY?.trim();
  const target = configured
    ? (pipes.find((p) => (p.pipelineKey ?? p.key) === configured) ?? pipes[0])
    : pipes[0];
  const targetKey = (target.pipelineKey ?? target.key) as string;
  console.log(
    configured
      ? `Checking the configured pipeline: ${String(target.name)}\n`
      : `STREAK_PIPELINE_KEY is not set — checking "${String(target.name)}" as a sample.\n`,
  );

  // --- Step 4: stages, and the stage mapping -----------------------------
  console.log('--- 4. Stages and how each one maps ---');
  const stagesRes = await probe(`${base}${API_SPEC.endpoints.stages(targetKey)}`, headers);
  const stagesJson = stagesRes.json;
  console.log(
    `Stages response is ${Array.isArray(stagesJson) ? 'an ARRAY' : typeof stagesJson === 'object' && stagesJson ? 'an OBJECT keyed by stage key' : 'unexpected'}.`,
  );

  const stageNames: string[] = Array.isArray(stagesJson)
    ? (stagesJson as Record<string, unknown>[]).map((s) => String(s.name ?? ''))
    : stagesJson && typeof stagesJson === 'object'
      ? Object.values(stagesJson as Record<string, { name?: string }>).map((s) =>
          String(s?.name ?? ''),
        )
      : [];

  let unmapped = 0;
  for (const name of stageNames) {
    const status = mapStageToStatus(name);
    if (status === 'unknown') unmapped += 1;
    console.log(`  ${status === 'unknown' ? '??' : 'ok'}  ${status.padEnd(13)} <- ${name}`);
  }
  console.log('');
  if (unmapped > 0) {
    console.log(
      `WARNING: ${unmapped} stage(s) above map to "unknown", which the UI labels\n` +
        '"Not in pipeline". Add a rule to STAGE_RULES in src/lib/connectors/streak.ts\n' +
        'for each one.\n',
    );
  } else {
    console.log('Every stage maps to a real status.\n');
  }

  // --- Step 5: boxes, size, and the paging parameters --------------------
  console.log('--- 5. Boxes: field shape and response size ---');
  const { limitParam, sortParam, sortField } = API_SPEC.boxQuery;
  const boxesPath = API_SPEC.endpoints.boxes(targetKey);

  const small = await probe(`${base}${boxesPath}?${limitParam}=5`, headers);
  const smallArr = (Array.isArray(small.json) ? small.json : []) as Record<string, unknown>[];
  console.log(
    `?${limitParam}=5 returned ${smallArr.length} box(es), ${small.bytes.toLocaleString()} bytes.`,
  );
  if (smallArr.length !== 5) {
    console.log(
      `WARNING: expected 5. The "${limitParam}" parameter is undocumented and may have\n` +
        'stopped working — fetchStreakJobs would then pull the whole pipeline.\n',
    );
  }

  // Does sortBy really sort? Compare against the unsorted first page.
  const sorted = await probe(
    `${base}${boxesPath}?${sortParam}=${sortField}&${limitParam}=5`,
    headers,
  );
  const sortedArr = (Array.isArray(sorted.json) ? sorted.json : []) as Record<string, unknown>[];
  const stamps = sortedArr.map((b) => Number(b[sortField])).filter(Number.isFinite);
  const descending = stamps.every((v, i) => i === 0 || stamps[i - 1] >= v);
  console.log(
    `?${sortParam}=${sortField} returned ${stamps.length} stamp(s), ` +
      `${descending ? 'newest first (as relied on).' : 'NOT in descending order — check this.'}`,
  );

  const sample = sortedArr[0] ?? smallArr[0];
  if (sample) {
    console.log(`\nFields on a live box (${Object.keys(sample).length} total):`);
    console.log(`  ${Object.keys(sample).sort().join(', ')}\n`);

    // Confirm every field the connector actually reads is present.
    const needed = [
      'boxKey',
      'key',
      'name',
      'stageKey',
      'creationTimestamp',
      'lastUpdatedTimestamp',
      'lastTouchpointTimestamp',
      'lastEmailReceivedTimestamp',
      'lastEmailSentTimestamp',
      'notes',
      'emailAddresses',
    ];
    console.log('Fields the connector reads:');
    for (const f of needed) {
      const present = f in sample;
      console.log(`  ${present ? 'ok' : '--'}  ${f}${present ? '' : ' (absent on this box)'}`);
    }
    console.log(`\nlastUpdatedTimestamp unit: ${timestampUnit(sample.lastUpdatedTimestamp)}`);
    console.log(
      'NOTE: fields such as notes and the email stamps are absent on some boxes,\n' +
        'which is why the connector treats them all as optional.\n',
    );
  }

  // How big is the whole pipeline? This is why the fetch is bounded.
  console.log('--- 6. Full-pipeline size (why fetchStreakJobs is bounded) ---');
  const all = await probe(`${base}${boxesPath}`, headers);
  const allArr = (Array.isArray(all.json) ? all.json : []) as unknown[];
  console.log(
    `Unbounded fetch: ${allArr.length.toLocaleString()} boxes, ` +
      `${(all.bytes / 1_048_576).toFixed(1)} MB of JSON.`,
  );
  console.log(
    `The connector requests the newest ${process.env.STREAK_BOX_LIMIT ?? 400} ` +
      '(STREAK_BOX_LIMIT) instead.\n',
  );

  console.log('=== Done. Field names, stage names and counts only — no client data. ===\n');
}

main().catch((e) => {
  console.error('Verifier failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

// Marks this file as a module so its top-level names are scoped to it,
// rather than colliding with the other verifier scripts.
export {};
