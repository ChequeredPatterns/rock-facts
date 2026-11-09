import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clusterJobs,
  extractRef,
  normaliseName,
  scoreMatch,
  type PartialJob,
} from '../src/lib/matcher';
import { mapStageToStatus } from '../src/lib/connectors/streak';
import { mapOnRentStatus } from '../src/lib/connectors/onrent';
import { notesText, splitIntoWindows } from '../src/lib/connectors/connecteam';
import {
  gateMode,
  isAllowedViewer,
  passwordMatches,
  signSession,
  verifySession,
} from '../src/lib/auth/viewer';
import { buildActionList, type ConnectedSystems } from '../src/lib/actions';
import {
  businessDayKey,
  businessInstant,
  formatEventTime,
  type Job,
} from '../src/lib/domain';

// --- Timezone handling ------------------------------------------------------
// The server runs in UTC; the business runs in Auckland (+12, or +13 in
// daylight saving). Getting this wrong shifts every displayed time by half a
// day, so it is pinned down here.

test('businessInstant produces the right Auckland wall-clock time in summer', () => {
  // 4 Nov is daylight saving (NZDT, +13), so 3pm Auckland is 02:00 UTC.
  const iso = businessInstant(2026, 11, 4, 15);
  assert.equal(iso, '2026-11-04T02:00:00.000Z');
});

test('businessInstant handles the winter offset too', () => {
  // 4 July is standard time (NZST, +12), so 3pm Auckland is 03:00 UTC.
  const iso = businessInstant(2026, 7, 4, 15);
  assert.equal(iso, '2026-07-04T03:00:00.000Z');
});

test('an evening job stays on its own day, not the next one', () => {
  // 10pm Auckland is 09:00 UTC the SAME day. A naive implementation using
  // the server clock would file this under the following day.
  const iso = businessInstant(2026, 11, 4, 22);
  assert.equal(businessDayKey(iso), '2026-11-04');
});

test('formatEventTime renders the Auckland hour, not the server hour', () => {
  const job = {
    id: 'j',
    clientName: 'x',
    status: 'accepted',
    crew: [],
    sources: [],
    matchConfidence: 'exact',
    eventStart: businessInstant(2026, 11, 4, 14),
    eventEnd: businessInstant(2026, 11, 4, 23),
  } as Job;
  assert.equal(formatEventTime(job), '2:00 pm – 11:00 pm');
});

const ALL_ON: ConnectedSystems = {
  streak: true,
  onrent: true,
  calendar: true,
  connecteam: true,
  gmail: true,
};

// --- Reference extraction ---------------------------------------------------

test('extractRef finds the common job-number formats', () => {
  assert.equal(extractRef('RF-1042 Smith Wedding'), 'RF-1042');
  assert.equal(extractRef('Smith Wedding RF1042'), 'RF-1042');
  assert.equal(extractRef('Quote #1042 for Jane'), 'RF-1042');
  assert.equal(extractRef('Job 1042 - Town Hall'), 'RF-1042');
});

test('extractRef ignores short numbers so dates are not read as job numbers', () => {
  // "21st" must not become a job reference.
  assert.equal(extractRef('Jane Smith 21st birthday'), undefined);
  assert.equal(extractRef('Party on the 5th'), undefined);
});

// --- Name normalisation -----------------------------------------------------

test('normaliseName makes word order and punctuation irrelevant', () => {
  assert.equal(normaliseName('Jane Smith'), normaliseName('Smith, Jane'));
  assert.equal(normaliseName('Acme Ltd.'), normaliseName('ACME'));
});

test('normaliseName strips event noise that differs between systems', () => {
  assert.equal(normaliseName('Smith Wedding'), normaliseName('Smith'));
});

test('normaliseName keeps genuinely different clients apart', () => {
  assert.notEqual(normaliseName('Jane Smith'), normaliseName('John Smith'));
});

// --- Pairwise matching ------------------------------------------------------

const base: PartialJob = { system: 'streak', externalId: 'a' };

test('a shared job reference is an exact match', () => {
  const r = scoreMatch(
    { ...base, ref: 'RF-1042', clientName: 'Totally Different' },
    { ...base, system: 'onrent', ref: 'RF-1042', clientName: 'Other Name Entirely' },
  );
  assert.equal(r?.confidence, 'exact');
});

test('same client email on different dates is NOT a match', () => {
  // A repeat client with two separate bookings must stay two jobs.
  const r = scoreMatch(
    { ...base, clientEmail: 'a@b.com', eventStart: '2026-01-10T00:00:00Z' },
    {
      ...base,
      system: 'calendar',
      clientEmail: 'a@b.com',
      eventStart: '2026-06-10T00:00:00Z',
    },
  );
  assert.equal(r, null);
});

test('same client email on the same date is an exact match', () => {
  const r = scoreMatch(
    { ...base, clientEmail: 'a@b.com', eventStart: '2026-01-10T09:00:00Z' },
    {
      ...base,
      system: 'calendar',
      clientEmail: 'A@B.com',
      eventStart: '2026-01-10T14:00:00Z',
    },
  );
  assert.equal(r?.confidence, 'exact');
});

test('name plus nearby date is a high-confidence match', () => {
  const r = scoreMatch(
    { ...base, clientName: 'Harbourside Weddings', eventStart: '2026-03-01T09:00:00Z' },
    {
      ...base,
      system: 'calendar',
      clientName: 'Harbourside',
      eventStart: '2026-03-01T18:00:00Z',
    },
  );
  assert.equal(r?.confidence, 'high');
});

test('name match with no date anywhere is flagged low confidence', () => {
  const r = scoreMatch(
    { ...base, clientName: 'Lane Cove Productions' },
    { ...base, system: 'calendar', clientName: 'Lane Cove Productions' },
  );
  assert.equal(r?.confidence, 'low');
});

test('unrelated records do not match', () => {
  const r = scoreMatch(
    { ...base, clientName: 'Alpha Events', eventStart: '2026-03-01T09:00:00Z' },
    { ...base, system: 'calendar', clientName: 'Beta Catering', eventStart: '2026-09-04T09:00:00Z' },
  );
  assert.equal(r, null);
});

// --- Clustering -------------------------------------------------------------

test('records from four systems collapse into one job', () => {
  const jobs = clusterJobs([
    { system: 'streak', externalId: 's1', ref: 'RF-1042', clientName: 'Smith', status: 'accepted' },
    { system: 'onrent', externalId: 'o1', ref: 'RF-1042', clientName: 'Smith', quoteTotal: 4850 },
    {
      system: 'calendar',
      externalId: 'c1',
      ref: 'RF-1042',
      clientName: 'Smith',
      eventStart: '2026-03-01T09:00:00Z',
      venue: 'Shed 10',
    },
    {
      system: 'connecteam',
      externalId: 'ct1',
      ref: 'RF-1042',
      clientName: 'Smith',
      crew: [{ id: 'u1', name: 'Sam', confirmed: true, source: 'connecteam' }],
    },
  ]);

  assert.equal(jobs.length, 1);
  const job = jobs[0];
  assert.equal(job.sources.length, 4);
  // Each system is trusted for what it owns.
  assert.equal(job.status, 'accepted', 'status comes from Streak');
  assert.equal(job.quoteTotal, 4850, 'money comes from On Rent');
  assert.equal(job.venue, 'Shed 10', 'timing and venue come from Calendar');
  assert.equal(job.crew.length, 1, 'crew comes from Connecteam');
});

test('two records from the same system are never merged together', () => {
  // One client, two Streak boxes, same day — these are two real jobs.
  const jobs = clusterJobs([
    { system: 'streak', externalId: 's1', clientName: 'Acme', eventStart: '2026-03-01T09:00:00Z' },
    { system: 'streak', externalId: 's2', clientName: 'Acme', eventStart: '2026-03-01T09:00:00Z' },
  ]);
  assert.equal(jobs.length, 2);
});

test('a cluster takes the weakest confidence of its joins', () => {
  const jobs = clusterJobs([
    { system: 'streak', externalId: 's1', clientName: 'Lane Cove' },
    { system: 'calendar', externalId: 'c1', clientName: 'Lane Cove' },
  ]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].matchConfidence, 'low');
});

// --- Streak stage mapping ---------------------------------------------------

test('"job not accepted" maps to not_accepted, not accepted', () => {
  // The dangerous case: substring collision between the two stage names.
  assert.equal(mapStageToStatus('Job not accepted'), 'not_accepted');
  assert.equal(mapStageToStatus('Accepted'), 'accepted');
});

test('the business\'s own stage names all map correctly', () => {
  assert.equal(mapStageToStatus('New enquiries'), 'new_enquiry');
  assert.equal(mapStageToStatus('Questions'), 'question');
  assert.equal(mapStageToStatus('Quoted'), 'quoted');
  assert.equal(mapStageToStatus('Completed job'), 'completed');
  assert.equal(mapStageToStatus(undefined), 'unknown');
});

/**
 * The REAL stage names of the live "Event Planning" pipeline, read from the
 * Streak API on 2026-11-04. These are verbatim — including the casing and the
 * parenthetical notes the team types into Streak — because the exact wording
 * is what the mapping has to survive.
 *
 * Two of these were genuinely mis-classified before being checked against the
 * live pipeline, and both have their own regression test below.
 */
const LIVE_STAGES: [string, string][] = [
  ['New Enquiries - MAKE CONTACT', 'new_enquiry'],
  ['QUOTING & WIPS (put into here when quoting or working on)', 'quoted'],
  ['Quoted (gets added to calendar as unconfirmed)', 'quoted'],
  ['Accepted - PREPARATION (Gets added to Cal as confirmed)', 'accepted'],
  ['OUT (Awaiting Return) OR Awaiting payment still', 'accepted'],
  ['Completed jobs / Previous Jobs / Past Clients', 'completed'],
  ['Questions, More info needed, Follow up, Limbo...', 'question'],
  ['POSTPONED', 'question'],
  ['Not Booked, Lost Job or Cancelled - removed from cal', 'not_accepted'],
  ['BLACKLISTED', 'not_accepted'],
  ['BOUNCED, INVALID, UNSUBSCRIBED', 'not_accepted'],
  ['NOT EVENTS', 'not_accepted'],
  ['Accounts Payable, Invoicing - Not the event organiser', 'not_accepted'],
  ['RELATIONSHIP BUILDING', 'not_accepted'],
  ['OLD CLIENTS TRYING TO CONTACT', 'not_accepted'],
];

test('every real stage in the live pipeline maps to the intended status', () => {
  for (const [stage, expected] of LIVE_STAGES) {
    assert.equal(mapStageToStatus(stage), expected, `stage: ${stage}`);
  }
});

test('no real stage falls through to unknown', () => {
  // 'unknown' is labelled "Not in pipeline" in the UI, so a box sitting in a
  // genuine stage must never land there.
  for (const [stage] of LIVE_STAGES) {
    assert.notEqual(mapStageToStatus(stage), 'unknown', `stage: ${stage}`);
  }
});

test('"unconfirmed" in the Quoted stage name does not read as confirmed', () => {
  // REGRESSION: "Quoted (gets added to calendar as unconfirmed)" used to match
  // on the "confirm" inside "unconfirmed" and come back as 'accepted', which
  // promoted every merely-quoted job to committed work on the dashboard.
  assert.equal(mapStageToStatus('Quoted (gets added to calendar as unconfirmed)'), 'quoted');
  // The genuinely confirmed stage must still map to accepted.
  assert.equal(
    mapStageToStatus('Accepted - PREPARATION (Gets added to Cal as confirmed)'),
    'accepted',
  );
});

test('a job that is out or awaiting payment counts as committed work', () => {
  // REGRESSION: this used to match on "Awaiting" and come back as 'question',
  // hiding gear that is physically out and invoices that are unpaid.
  assert.equal(mapStageToStatus('OUT (Awaiting Return) OR Awaiting payment still'), 'accepted');
});

test('"Not Booked" is not read as "booked"', () => {
  assert.equal(mapStageToStatus('Not Booked, Lost Job or Cancelled - removed from cal'), 'not_accepted');
  assert.equal(mapStageToStatus('Booked'), 'accepted');
});

// --- Action rules -----------------------------------------------------------

function jobFixture(over: Partial<Job>): Job {
  return {
    id: 'j1',
    clientName: 'Test Client',
    status: 'accepted',
    crew: [],
    sources: [{ system: 'streak', externalId: 's1' }],
    matchConfidence: 'exact',
    ...over,
  };
}

const NOW = new Date('2026-03-01T00:00:00Z');

test('a confirmed job days away with no crew raises an urgent alert', () => {
  const job = jobFixture({
    status: 'accepted',
    eventStart: '2026-03-03T09:00:00Z',
    crew: [],
    sources: [{ system: 'streak', externalId: 's1' }, { system: 'calendar', externalId: 'c1' }],
  });
  const items = buildActionList([job], ALL_ON, NOW);
  const alert = items.find((i) => i.title === 'No crew booked');
  assert.ok(alert, 'expected a no-crew alert');
  assert.equal(alert!.severity, 'urgent');
});

test('no crew alert is suppressed when Connecteam is not connected', () => {
  // Critical: never claim nobody is booked when we cannot see the bookings.
  const job = jobFixture({ status: 'accepted', eventStart: '2026-03-03T09:00:00Z', crew: [] });
  const items = buildActionList([job], { ...ALL_ON, connecteam: false }, NOW);
  assert.equal(items.find((i) => i.title === 'No crew booked'), undefined);
});

test('a quote gone quiet is raised, and escalates when the event is close', () => {
  const far = jobFixture({
    status: 'quoted',
    eventStart: '2026-09-01T09:00:00Z',
    sources: [{ system: 'streak', externalId: 's1', lastActivityAt: '2026-02-20T00:00:00Z' }],
  });
  const near = jobFixture({
    status: 'quoted',
    eventStart: '2026-03-08T09:00:00Z',
    sources: [{ system: 'streak', externalId: 's1', lastActivityAt: '2026-02-20T00:00:00Z' }],
  });
  assert.equal(buildActionList([far], ALL_ON, NOW)[0].severity, 'soon');
  assert.equal(buildActionList([near], ALL_ON, NOW)[0].severity, 'urgent');
});

test('a calendar booking with no Streak box is surfaced', () => {
  const job = jobFixture({
    status: 'unknown',
    eventStart: '2026-03-10T09:00:00Z',
    sources: [{ system: 'calendar', externalId: 'c1' }],
  });
  const items = buildActionList([job], ALL_ON, NOW);
  assert.ok(items.find((i) => i.title === 'Not tracked in Streak'));
});

test('fully staffed, fully tracked jobs raise nothing', () => {
  const job = jobFixture({
    status: 'accepted',
    eventStart: '2026-03-03T09:00:00Z',
    crewRequired: 2,
    crew: [
      { id: 'a', name: 'Sam', confirmed: true, source: 'connecteam' },
      { id: 'b', name: 'Alex', confirmed: true, source: 'connecteam' },
    ],
    sources: [
      { system: 'streak', externalId: 's1', lastActivityAt: '2026-02-28T00:00:00Z' },
      { system: 'calendar', externalId: 'c1' },
      { system: 'onrent', externalId: 'o1' },
      { system: 'connecteam', externalId: 'ct1' },
    ],
  });
  assert.equal(buildActionList([job], ALL_ON, NOW).length, 0);
});

test('unconfirmed crew still count as a shortfall', () => {
  const job = jobFixture({
    status: 'accepted',
    eventStart: '2026-03-03T09:00:00Z',
    crewRequired: 2,
    crew: [
      { id: 'a', name: 'Sam', confirmed: true, source: 'connecteam' },
      { id: 'b', name: 'Alex', confirmed: false, source: 'connecteam' },
    ],
    sources: [{ system: 'streak', externalId: 's1' }, { system: 'calendar', externalId: 'c1' }],
  });
  const items = buildActionList([job], ALL_ON, NOW);
  assert.ok(items.find((i) => i.title.startsWith('Short 1 crew')));
});

// --- On Rent Events / Current RMS status mapping ----------------------------
// Current RMS carries both a lifecycle `state` and a sub-status `status`. The
// four combinations below are every one present in the live account, checked
// across all 50 opportunities, so these are real cases and not invented ones.

test('Current RMS: an Order on "Open" counts as accepted', () => {
  // The regression that mattered: "Open" matches no rule on its own, so reading
  // the sub-status alone left 15 of 50 opportunities — the confirmed work —
  // with no status, and therefore outside the committed set that drives the
  // crew and logistics warnings.
  assert.equal(mapOnRentStatus('Open', 'Order'), 'accepted');
});

test('Current RMS: an Order on "Active" counts as accepted', () => {
  assert.equal(mapOnRentStatus('Active', 'Order'), 'accepted');
});

test('Current RMS: a Quotation on "Provisional" is only quoted', () => {
  assert.equal(mapOnRentStatus('Provisional', 'Quotation'), 'quoted');
});

test('Current RMS: a Draft on "Open" is a new enquiry, not accepted work', () => {
  // Same sub-status as a confirmed Order, opposite end of the pipeline. This is
  // why the state has to decide rather than the status.
  assert.equal(mapOnRentStatus('Open', 'Draft'), 'new_enquiry');
});

test('Current RMS: "Open" alone, with no state, stays unknown', () => {
  assert.equal(mapOnRentStatus('Open', undefined), undefined);
});

test('Current RMS: a cancelled order is not accepted, whichever field says so', () => {
  assert.equal(mapOnRentStatus('Open', 'Cancelled'), 'not_accepted');
  assert.equal(mapOnRentStatus('Cancelled', 'Order'), 'not_accepted');
});

test('Current RMS: a completed order reads as completed, not merely accepted', () => {
  assert.equal(mapOnRentStatus('Completed', 'Order'), 'completed');
});

test('Current RMS: nothing at all maps to nothing', () => {
  assert.equal(mapOnRentStatus(undefined, undefined), undefined);
  assert.equal(mapOnRentStatus('', ''), undefined);
});

// --- Who may view the dashboard --------------------------------------------
// This is the gate that keeps live client data off the open internet, so the
// cases that matter most here are the ones where it must REFUSE.

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  const restore = () => {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
  let out: T;
  try {
    out = fn();
  } catch (err) {
    restore();
    throw err;
  }
  // Restore only once the async body has settled, or a later test would run
  // against environment variables this one had swapped out.
  if (out instanceof Promise) return out.finally(restore) as T;
  restore();
  return out;
}

const NO_CREDS = {
  GOOGLE_REFRESH_TOKEN: undefined,
  STREAK_API_KEY: undefined,
  CONNECTEAM_API_KEY: undefined,
  ONRENT_API_KEY: undefined,
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  SESSION_SECRET: undefined,
  ALLOWED_EMAILS: undefined,
  ALLOWED_EMAIL_DOMAINS: undefined,
  SITE_PASSWORD: undefined,
};

test('no allowlist admits nobody, rather than everybody', () => {
  withEnv({ ...NO_CREDS }, () => {
    assert.equal(isAllowedViewer('anyone@gmail.com'), false);
  });
});

test('an allowlisted address is admitted, case-insensitively', () => {
  withEnv({ ...NO_CREDS, ALLOWED_EMAILS: 'Boss@Example.com, crew@example.com' }, () => {
    assert.equal(isAllowedViewer('boss@example.com'), true);
    assert.equal(isAllowedViewer('BOSS@EXAMPLE.COM'), true);
    assert.equal(isAllowedViewer('someone.else@example.com'), false);
  });
});

test('a domain allowlist admits that domain and no other', () => {
  withEnv({ ...NO_CREDS, ALLOWED_EMAIL_DOMAINS: '@example.com' }, () => {
    assert.equal(isAllowedViewer('anyone@example.com'), true);
    assert.equal(isAllowedViewer('attacker@evil.com'), false);
    // The domain is the part after the final @, not merely present somewhere.
    assert.equal(isAllowedViewer('attacker@example.com.evil.com'), false);
    assert.equal(isAllowedViewer('example.com@evil.com'), false);
  });
});

test('malformed addresses are refused', () => {
  withEnv({ ...NO_CREDS, ALLOWED_EMAIL_DOMAINS: 'example.com' }, () => {
    assert.equal(isAllowedViewer(undefined), false);
    assert.equal(isAllowedViewer(''), false);
    assert.equal(isAllowedViewer('no-at-sign'), false);
    assert.equal(isAllowedViewer('@example.com'), false);
    assert.equal(isAllowedViewer('a@b@example.com'), false);
  });
});

test('the gate opens only while there is no real data to protect', () => {
  withEnv({ ...NO_CREDS }, () => {
    assert.equal(gateMode(), 'open');
  });
});

test('one connector key is enough to turn the gate on', () => {
  withEnv({ ...NO_CREDS, ONRENT_API_KEY: 'x' }, () => {
    // Sign-in is not configured, so it must lock rather than open.
    assert.equal(gateMode(), 'locked');
  });
});

test('with data and a working sign-in, the gate enforces', () => {
  withEnv(
    {
      ...NO_CREDS,
      ONRENT_API_KEY: 'x',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      ALLOWED_EMAILS: 'boss@example.com',
    },
    () => {
      assert.equal(gateMode(), 'enforced');
    },
  );
});

test('a session round-trips, and a tampered one is rejected', async () => {
  await withEnv(
    { ...NO_CREDS, GOOGLE_CLIENT_SECRET: 'signing-key', ALLOWED_EMAILS: 'boss@example.com' },
    async () => {
      const token = await signSession('boss@example.com');
      assert.ok(token);
      assert.equal((await verifySession(token!))?.email, 'boss@example.com');

      // Swapping the payload for another address must not survive the signature.
      const forgedBody = Buffer.from(
        JSON.stringify({ email: 'attacker@evil.com', exp: Math.floor(Date.now() / 1000) + 999 }),
      ).toString('base64url');
      assert.equal(await verifySession(`${forgedBody}.${token!.split('.')[1]}`), null);
      assert.equal(await verifySession('garbage'), null);
      assert.equal(await verifySession(undefined), null);
    },
  );
});

test('an expired session is rejected', async () => {
  await withEnv(
    { ...NO_CREDS, GOOGLE_CLIENT_SECRET: 'signing-key', ALLOWED_EMAILS: 'boss@example.com' },
    async () => {
      const token = await signSession('boss@example.com', 'google', Date.now());
      // Fifteen days later, past the fourteen-day life.
      assert.equal(await verifySession(token!, Date.now() + 15 * 86400_000), null);
    },
  );
});

test('a session signed with a different key is rejected', async () => {
  const token = await withEnv(
    { ...NO_CREDS, GOOGLE_CLIENT_SECRET: 'old-key', ALLOWED_EMAILS: 'boss@example.com' },
    async () => signSession('boss@example.com'),
  );
  await withEnv(
    { ...NO_CREDS, GOOGLE_CLIENT_SECRET: 'rotated-key', ALLOWED_EMAILS: 'boss@example.com' },
    async () => {
      assert.equal(await verifySession((await token) ?? undefined), null);
    },
  );
});

test('removing someone from the allowlist invalidates their existing session', async () => {
  const token = await withEnv(
    { ...NO_CREDS, GOOGLE_CLIENT_SECRET: 'k', ALLOWED_EMAILS: 'leaver@example.com' },
    async () => signSession('leaver@example.com'),
  );
  await withEnv(
    { ...NO_CREDS, GOOGLE_CLIENT_SECRET: 'k', ALLOWED_EMAILS: 'boss@example.com' },
    async () => {
      assert.equal(await verifySession((await token) ?? undefined), null);
    },
  );
});

// --- Shared-password sign-in -----------------------------------------------
// A short shared password is the weakest of the options offered, so these
// cover the ways it must not fail open.

test('the password is compared exactly, and nothing else is accepted', () => {
  withEnv({ ...NO_CREDS, SITE_PASSWORD: 'Tr0mbone-Str4w' }, () => {
    assert.equal(passwordMatches('Tr0mbone-Str4w'), true);
    assert.equal(passwordMatches('tr0mbone-str4w'), false, 'must be case-sensitive');
    assert.equal(passwordMatches('Tr0mbone-Str4w '), false, 'no trailing whitespace');
    assert.equal(passwordMatches(' Tr0mbone-Str4w'), false, 'no leading whitespace');
    assert.equal(passwordMatches('Tr0mbone-Str4'), false, 'a prefix is not enough');
    assert.equal(passwordMatches('Tr0mbone-Str4ww'), false, 'nor is a longer string');
    assert.equal(passwordMatches(''), false);
    assert.equal(passwordMatches(undefined), false);
  });
});

test('with no password configured, nothing is accepted — including empty', () => {
  withEnv({ ...NO_CREDS }, () => {
    assert.equal(passwordMatches(''), false);
    assert.equal(passwordMatches(undefined), false);
    assert.equal(passwordMatches('anything'), false);
  });
});

test('a password alone is enough to unlock the gate', () => {
  withEnv({ ...NO_CREDS, ONRENT_API_KEY: 'x', SITE_PASSWORD: 'Tr0mbone-Str4w' }, () => {
    assert.equal(gateMode(), 'enforced');
  });
});

test('a password session round-trips', async () => {
  await withEnv({ ...NO_CREDS, SITE_PASSWORD: 'Tr0mbone-Str4w' }, async () => {
    const token = await signSession('password', 'password');
    const session = await verifySession(token ?? undefined);
    assert.equal(session?.via, 'password');
  });
});

test('turning the password off evicts everyone who used it', async () => {
  const token = await withEnv({ ...NO_CREDS, SITE_PASSWORD: 'Tr0mbone-Str4w' }, async () =>
    signSession('password', 'password'),
  );
  await withEnv({ ...NO_CREDS, SESSION_SECRET: 'unchanged-key' }, async () => {
    assert.equal(await verifySession((await token) ?? undefined), null);
  });
});

test('changing the password signs existing sessions out', async () => {
  const token = await withEnv({ ...NO_CREDS, SITE_PASSWORD: 'Tr0mbone-Str4w' }, async () =>
    signSession('password', 'password'),
  );
  await withEnv({ ...NO_CREDS, SITE_PASSWORD: 'An0ther-Pass' }, async () => {
    assert.equal(await verifySession((await token) ?? undefined), null);
  });
});

test('a password session cannot be re-labelled as a Google one', async () => {
  // The `via` field is inside the signed payload, so switching it should
  // break the signature rather than smuggle someone past the allowlist.
  await withEnv(
    { ...NO_CREDS, SITE_PASSWORD: 'Tr0mbone-Str4w', ALLOWED_EMAILS: 'boss@example.com' },
    async () => {
      const token = await signSession('password', 'password');
      const [body, tag] = token!.split('.');
      const swapped = Buffer.from(
        JSON.stringify({
          email: 'boss@example.com',
          via: 'google',
          exp: Math.floor(Date.now() / 1000) + 999,
        }),
      ).toString('base64url');
      assert.notEqual(body, swapped);
      assert.equal(await verifySession(`${swapped}.${tag}`), null);
    },
  );
});

// --- Connecteam's 92-day ceiling -------------------------------------------
// The live API answers a wider span with HTTP 400 "Date range cannot be more
// than 92 days". The dashboard asks for 150 days, so without splitting, crew
// data never loaded at all.

test('the dashboard window is split into windows the API will accept', () => {
  const from = new Date('2026-01-01T00:00:00Z');
  const to = new Date(from.getTime() + 150 * 86_400_000);
  const windows = splitIntoWindows(from, to);

  assert.ok(windows.length >= 2, 'a 150-day span cannot be one request');
  for (const w of windows) {
    const days = (w.to.getTime() - w.from.getTime()) / 86_400_000;
    assert.ok(days <= 92, `window of ${days} days exceeds the API limit`);
  }
  // The windows must tile the span exactly: no gap would silently drop shifts.
  assert.equal(windows[0].from.getTime(), from.getTime());
  assert.equal(windows[windows.length - 1].to.getTime(), to.getTime());
  for (let i = 1; i < windows.length; i++) {
    assert.equal(windows[i].from.getTime(), windows[i - 1].to.getTime(), 'no gap');
  }
});

test('a span already within the limit stays a single request', () => {
  const from = new Date('2026-01-01T00:00:00Z');
  const to = new Date(from.getTime() + 30 * 86_400_000);
  assert.equal(splitIntoWindows(from, to).length, 1);
});

test('a zero-length or inverted span does not loop forever', () => {
  const d = new Date('2026-01-01T00:00:00Z');
  assert.equal(splitIntoWindows(d, d).length, 1);
  assert.equal(splitIntoWindows(d, new Date(d.getTime() - 86_400_000)).length, 1);
});

// --- Connecteam's `notes` is not a string ----------------------------------
// The field is documented as text but the live API returns an array. Feeding
// that straight to extractRef threw and took the whole connector down.

test('notes survives whatever shape the API sends', () => {
  assert.equal(notesText(undefined), undefined);
  assert.equal(notesText(null), undefined);
  assert.equal(notesText([]), undefined, 'the live case: an empty array');
  assert.equal(notesText('RF-1042 load in'), 'RF-1042 load in');
  assert.equal(notesText(['RF-1042', 'load in']), 'RF-1042 load in');
  assert.equal(notesText([{ text: 'RF-1042' }]), 'RF-1042');
  assert.equal(notesText({ body: 'RF-1042' }), 'RF-1042');
  assert.equal(notesText([42, true]), undefined, 'non-text entries are ignored');
});

test('a job number is still found inside array-shaped notes', () => {
  assert.equal(extractRef(notesText([{ text: 'job RF-1042 on site' }])), 'RF-1042');
});

test('extractRef refuses non-strings instead of throwing', () => {
  // This is the exact crash: an array reached extractRef and .match blew up.
  assert.equal(extractRef([] as unknown), undefined);
  assert.equal(extractRef({} as unknown), undefined);
  assert.equal(extractRef(42 as unknown), undefined);
  assert.equal(extractRef(null as unknown), undefined);
});
