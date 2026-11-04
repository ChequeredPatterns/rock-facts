/**
 * Sample data, used only when nothing is connected yet.
 *
 * Every screen in the UI labels this clearly as example data. The figures are
 * invented and must never be read as real business numbers — the point is
 * purely to let the team see and critique the interface before the account
 * owner spends time on credentials.
 *
 * Crew names here are invented placeholders, not real people.
 */

import { businessDateParts, businessInstant, type Job } from './domain';

const CREW = ['Sam', 'Alex', 'Jo', 'Riley'];

/**
 * An instant whose Auckland wall-clock time is `hour:00`, `dayOffset` days
 * from now. Using setHours() here would resolve the hour in the *server's*
 * timezone — UTC on the host — and every sample job would display 12–13 hours
 * out, making the sample data look broken.
 */
function at(now: Date, dayOffset: number, hour: number): string {
  const { year, month, day } = businessDateParts(now, dayOffset);
  return businessInstant(year, month, day, hour);
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export function sampleJobs(now: Date = new Date()): Job[] {
  return [
    {
      id: 'streak:sample-1',
      ref: 'RF-1042',
      clientName: 'Harbourside Weddings',
      clientEmail: 'events@harboursidesample.co.nz',
      status: 'accepted',
      eventStart: at(now, 2, 14),
      eventEnd: at(now, 2, 23),
      venue: 'Shed 10, Queens Wharf',
      quoteTotal: 4850,
      crew: [
        { id: 'c1', name: 'Sam', role: 'Sound', confirmed: true, source: 'connecteam' },
        { id: 'c2', name: 'Jo', role: 'Lighting', confirmed: true, source: 'connecteam' },
      ],
      crewRequired: 4,
      sources: [
        { system: 'streak', externalId: 's1', lastActivityAt: daysAgo(now, 1) },
        { system: 'onrent', externalId: 'q1042', lastActivityAt: daysAgo(now, 3) },
        { system: 'calendar', externalId: 'cal1', lastActivityAt: daysAgo(now, 1) },
        { system: 'connecteam', externalId: 'ct1' },
      ],
      matchConfidence: 'exact',
      matchReason: 'Matched on job reference RF-1042',
    },
    {
      id: 'streak:sample-2',
      ref: 'RF-1048',
      clientName: 'Northside Rugby Club',
      clientEmail: 'admin@northsidesample.co.nz',
      status: 'accepted',
      eventStart: at(now, 5, 17),
      eventEnd: at(now, 5, 23),
      venue: 'Northside Clubrooms',
      quoteTotal: 2300,
      crew: [],
      crewRequired: 3,
      sources: [
        { system: 'streak', externalId: 's2', lastActivityAt: daysAgo(now, 2) },
        { system: 'onrent', externalId: 'q1048', lastActivityAt: daysAgo(now, 2) },
        { system: 'calendar', externalId: 'cal2', lastActivityAt: daysAgo(now, 2) },
      ],
      matchConfidence: 'exact',
    },
    {
      id: 'streak:sample-3',
      ref: 'RF-1051',
      clientName: 'Meridian Corporate',
      clientEmail: 'procurement@meridiansample.co.nz',
      status: 'quoted',
      eventStart: at(now, 11, 18),
      eventEnd: at(now, 11, 23),
      venue: 'Aotea Centre',
      quoteTotal: 12400,
      crew: [],
      sources: [
        { system: 'streak', externalId: 's3', lastActivityAt: daysAgo(now, 8) },
        { system: 'onrent', externalId: 'q1051', lastActivityAt: daysAgo(now, 8) },
      ],
      matchConfidence: 'exact',
    },
    {
      id: 'streak:sample-4',
      clientName: 'Tui Street Festival',
      clientEmail: 'hello@tuistreetsample.org.nz',
      status: 'new_enquiry',
      eventStart: at(now, 34, 12),
      venue: 'Tui Street',
      crew: [],
      sources: [{ system: 'streak', externalId: 's4', lastActivityAt: daysAgo(now, 6) }],
      matchConfidence: 'exact',
    },
    {
      id: 'streak:sample-5',
      ref: 'RF-1039',
      clientName: 'Pacific Sounds Ltd',
      clientEmail: 'bookings@pacificsoundssample.co.nz',
      status: 'accepted',
      eventStart: at(now, 1, 9),
      eventEnd: at(now, 1, 18),
      venue: 'Western Springs',
      quoteTotal: 8750,
      crew: [
        { id: 'c3', name: 'Alex', role: 'Crew chief', confirmed: true, source: 'connecteam' },
        { id: 'c4', name: 'Riley', role: 'Stage', confirmed: false, source: 'connecteam' },
        { id: 'c5', name: 'Sam', role: 'Sound', confirmed: true, source: 'connecteam' },
      ],
      crewRequired: 3,
      sources: [
        { system: 'streak', externalId: 's5', lastActivityAt: daysAgo(now, 1) },
        { system: 'onrent', externalId: 'q1039' },
        { system: 'calendar', externalId: 'cal5' },
        { system: 'connecteam', externalId: 'ct5' },
      ],
      matchConfidence: 'exact',
    },
    {
      id: 'calendar:sample-6',
      clientName: 'Garage Project Launch',
      status: 'unknown',
      eventStart: at(now, 8, 16),
      eventEnd: at(now, 8, 22),
      venue: 'Britomart',
      crew: [{ id: 'c6', name: 'Jo', confirmed: false, source: 'calendar' }],
      sources: [{ system: 'calendar', externalId: 'cal6', lastActivityAt: daysAgo(now, 4) }],
      matchConfidence: 'exact',
    },
    {
      id: 'streak:sample-7',
      clientName: 'Rotary Club Gala',
      clientEmail: 'gala@rotarysample.org.nz',
      status: 'question',
      eventStart: at(now, 46, 18),
      crew: [],
      sources: [{ system: 'streak', externalId: 's7', lastActivityAt: daysAgo(now, 4) }],
      matchConfidence: 'exact',
    },
    {
      id: 'streak:sample-8',
      ref: 'RF-1021',
      clientName: 'Summit Conference Co',
      clientEmail: 'ops@summitsample.co.nz',
      status: 'completed',
      eventStart: at(now, -6, 8),
      eventEnd: at(now, -6, 19),
      venue: 'Viaduct Events Centre',
      quoteTotal: 15600,
      crew: [
        { id: 'c7', name: 'Alex', confirmed: true, source: 'connecteam' },
        { id: 'c8', name: 'Riley', confirmed: true, source: 'connecteam' },
      ],
      crewRequired: 2,
      sources: [
        { system: 'streak', externalId: 's8', lastActivityAt: daysAgo(now, 5) },
        { system: 'onrent', externalId: 'q1021' },
        { system: 'calendar', externalId: 'cal8' },
        { system: 'connecteam', externalId: 'ct8' },
      ],
      matchConfidence: 'exact',
    },
    {
      id: 'streak:sample-9',
      clientName: 'Lane Cove Productions',
      status: 'quoted',
      eventStart: at(now, 19, 19),
      venue: 'The Powerstation',
      quoteTotal: 6200,
      crew: [],
      sources: [
        { system: 'streak', externalId: 's9', lastActivityAt: daysAgo(now, 12) },
        { system: 'calendar', externalId: 'cal9', lastActivityAt: daysAgo(now, 12) },
      ],
      matchConfidence: 'low',
      matchReason: 'Matched on client name only — no event date to confirm. Please verify.',
    },
  ];
}

export { CREW as SAMPLE_CREW };
