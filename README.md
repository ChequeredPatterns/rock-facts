# The Rock Factory Central

One overview across the five systems the business runs on — Gmail, Streak,
On Rent Events, Google Calendar and Connecteam.

**Two screens:**

- **Timeline** (main) — everything coming up, by date, with quote value,
  pipeline status, crew, and which systems hold a record for each job.
- **Action needed** — what is at risk of slipping: enquiries left unquoted,
  quotes with no reply, confirmed jobs with nobody booked, events missing from
  the calendar.

Plus a **Setup** page showing, in plain language, what is connected and what
is not.

→ **To connect it to your real systems, follow [SETUP.md](./SETUP.md).**

---

## Current state

The app is complete and runs. Until credentials are added it shows clearly
labelled **sample data**, so the interface can be reviewed before anyone spends
time on API keys. The sample disappears automatically the moment one real
system is connected.

### Connector status

| System | Status | Note |
|---|---|---|
| Google Calendar | ✅ Built, spec verified | Calendar API v3 is stable and well documented |
| Gmail | ✅ Built, spec verified | Shares the Google sign-in; metadata only |
| Streak | ⚠️ Built, **spec unverified** | See below |
| Connecteam | ⚠️ Built, **spec unverified** | See below; also check plan gating |
| On Rent Events | ⛔ Built but disabled | API details unknown — see below |

**Why three are unverified.** The environment this was built in blocks outbound
network access to `streak.readme.io`, `developer.connecteam.com` and
`onrentevents.com`, so their documentation could not be read and their APIs
could not be called. Rather than present guessed endpoint details as verified,
each of those connectors keeps everything uncertain in a single clearly-marked
`API_SPEC` block at the top of its file:

- `src/lib/connectors/streak.ts`
- `src/lib/connectors/connecteam.ts`
- `src/lib/connectors/onrent.ts`

Correcting any of them against the real documentation is a one-file change; no
other part of the app needs to move. On Rent Events deliberately refuses to run
until configured rather than silently returning wrong data.

---

## How it works

The interesting problem here is that **these five systems share no common
identifier**. A dashboard that just lists them side by side is no better than
five browser tabs. The value is in knowing that a calendar entry, a Streak box
and an On Rent quote are all *the same job* — so the app can say "this is
accepted, it's on Saturday, and nobody is booked".

```
vendor APIs ──▶ connectors ──▶ PartialJob[] ──▶ matcher ──▶ Job[] ──▶ UI
                                                              │
                                                              └──▶ action rules
```

- **`src/lib/connectors/*`** — one per system. Each returns `PartialJob[]`:
  that system's partial view of some jobs. Vendor payload shapes never escape
  this layer.
- **`src/lib/matcher.ts`** — clusters partials into whole jobs. Matches on
  shared job reference (exact), then client email + date, then normalised name
  + date. Every match carries a confidence, and low-confidence joins are shown
  as uncertain rather than asserted. Two records from the *same* system are
  never merged, so a repeat client never collapses into one row.
- **`src/lib/actions.ts`** — the alert rules. Each rule is gated on the systems
  it needs: if Connecteam is down, the app will not claim a job has no crew.
- **`src/lib/aggregate.ts`** — fetches everything in parallel and isolates
  failures, so one vendor having a bad morning never blanks the dashboard.

### Field authority

When systems disagree, each is trusted for what it is actually the system of
record for:

| Field | Authoritative source |
|---|---|
| Pipeline status | Streak |
| Quote value | On Rent Events |
| Event date, time, venue | Google Calendar |
| Crew | Connecteam |

---

## Running it locally

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:3000>. With no credentials set it runs on sample
data.

```bash
npm run verify
```

Runs the typecheck and the test suite (26 tests, covering the matcher, the
Streak stage mapping, the alert rules and timezone handling).

---

## Deploying

The app is built for Vercel, which suits a team with no coding experience:
deploys happen automatically on push, and API keys are entered in a web form
rather than a file. All vendor calls happen server-side, so no key is ever
exposed to the browser.

1. Import this repository at <https://vercel.com/new>
2. Add environment variables (see [SETUP.md](./SETUP.md))
3. Deploy

---

## Timezone

Everything resolves against `Pacific/Auckland`, including daylight saving,
regardless of where the server runs. Vercel runs in UTC, so this is not
cosmetic — see `businessInstant()` in `src/lib/domain.ts`.

---

## Branding

The wordmark is rendered in CSS (`src/components/Wordmark.tsx`) so it stays
crisp at any size and adapts automatically to dark mode. To use the supplied
logo file instead, drop it at `public/logo.png` and follow the two-line note in
that file. Note the supplied logo is solid black and will need a white variant
for dark backgrounds — which is why CSS is the default.
