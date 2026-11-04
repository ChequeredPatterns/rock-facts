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
