/**
 * Configuration and connection state.
 *
 * Every credential is read from environment variables, which on Vercel are
 * entered through a web form — nobody on the team ever edits a file or runs a
 * terminal. Nothing here is exposed to the browser: all values are read in
 * server-side code only, and the UI receives connection *status*, never keys.
 */

import type { SystemId } from './domain';

export interface SystemConfig {
  id: SystemId;
  label: string;
  /** Env vars this system needs before it can be used. */
  requiredEnv: string[];
  /** Plain-English note shown on the setup page when not configured. */
  setupHint: string;
  /**
   * Whether this connector's request format has been verified against the
   * vendor's live API docs. See README — the build environment could not
   * reach three of the four vendors' documentation.
   */
  specVerified: boolean;
}

export const SYSTEMS: SystemConfig[] = [
  {
    id: 'calendar',
    label: 'Google Calendar',
    requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
    setupHint:
      'Needs a one-off Google sign-in to grant read access to your calendars. This is the single step that requires the account owner.',
    specVerified: true,
  },
  {
    id: 'gmail',
    label: 'Gmail',
    requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
    setupHint:
      'Uses the same Google sign-in as Calendar — no extra step if Calendar is already connected.',
    specVerified: true,
  },
  {
    id: 'streak',
    label: 'Streak',
    requiredEnv: ['STREAK_API_KEY', 'STREAK_PIPELINE_KEY'],
    setupHint:
      'Get the API key from Gmail → Streak → Integrations → API Key. The pipeline key is read automatically once the API key works.',
    specVerified: false,
  },
  {
    id: 'connecteam',
    label: 'Connecteam',
    requiredEnv: ['CONNECTEAM_API_KEY', 'CONNECTEAM_SCHEDULER_ID'],
    setupHint:
      'The account owner creates a key under General Settings → API keys. Note that Connecteam gates API access to its higher plans.',
    specVerified: false,
  },
  {
    id: 'onrent',
    label: 'On Rent Events',
    requiredEnv: ['ONRENT_API_KEY', 'ONRENT_SUBDOMAIN'],
    setupHint:
      'On Rent Events documents an open API, but its specifics could not be confirmed during this build. See README before enabling.',
    specVerified: false,
  },
];

export function isConfigured(system: SystemId): boolean {
  const cfg = SYSTEMS.find((s) => s.id === system);
  if (!cfg) return false;
  return cfg.requiredEnv.every((key) => {
    const v = process.env[key];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

export function missingEnv(system: SystemId): string[] {
  const cfg = SYSTEMS.find((s) => s.id === system);
  if (!cfg) return [];
  return cfg.requiredEnv.filter((key) => !process.env[key]?.trim());
}

/** True when no system at all is connected, so the UI can offer sample data. */
export function anySystemConfigured(): boolean {
  return SYSTEMS.some((s) => isConfigured(s.id));
}

/**
 * Sample-data mode. Lets the team see and critique the whole interface before
 * any credentials exist. Explicitly labelled in the UI so sample figures can
 * never be mistaken for real ones.
 */
export function useSampleData(): boolean {
  if (process.env.ROCK_FACTORY_SAMPLE_DATA === 'true') return true;
  if (process.env.ROCK_FACTORY_SAMPLE_DATA === 'false') return false;
  return !anySystemConfigured();
}
