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

### Verifying a connector against the live API

```bash
npm run verify:connecteam
```

Probes the real Connecteam API with your key and reports what is actually
true: which auth header works, which endpoint paths exist, the real response
field names, and — importantly — whether shift timestamps are in seconds,
milliseconds or ISO strings. That last one is the most likely source of a
silent wrong-data bug, since a seconds value read as milliseconds puts every
shift in 1970.

It needs two things:

1. `CONNECTEAM_API_KEY` set as an **environment secret**, not pasted into a
   chat or passed on the command line (it would persist in shell history).
2. Network access to `api.connecteam.com`. In a cloud session, add that host
   under the environment's **Allowed domains**.

The output is deliberately shapes only — field names, types and detected
timestamp units, never record values — so it is safe to share. You do not need
to find `CONNECTEAM_SCHEDULER_ID` by hand; the script reports it.

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

Deployed to **Netlify**, whose free Starter plan permits commercial projects —
unlike Vercel's free Hobby plan, which is personal use only. That matters for
a business tool, so Netlify is the default and `netlify.toml` is committed.

It also suits a team with no coding experience: deploys happen automatically
on push, and API keys are entered in a web form rather than a file. All vendor
calls happen server-side, so no key is ever exposed to the browser.

1. Sign up at <https://app.netlify.com/signup> with GitHub
2. **Add new site** → **Import an existing project** → pick this repository
3. Change nothing, click **Deploy**
4. Add environment variables under **Site configuration → Environment
   variables** (see [SETUP.md](./SETUP.md)), then trigger a deploy

Nothing ties the app to Netlify — it is a standard Next.js app and will run on
Vercel, Cloudflare Workers (via OpenNext) or any Node host. Only the redirect
URI registered with Google is host-specific.

---

## Timezone

Everything resolves against `Pacific/Auckland`, including daylight saving,
regardless of where the server runs. Hosting platforms run in UTC, so this is
not cosmetic — see `businessInstant()` in `src/lib/domain.ts`.

---

## Look and feel

Dark, futuristic: deep-space base, glass panels, luminous hairlines, and a
cyan-to-violet accent range. The whole visual layer lives in
`src/app/globals.css` as CSS custom properties — changing `--cyan`, `--violet`
or the surface tokens at the top of that file re-themes the entire app without
touching a component.

Colour is kept meaningful rather than decorative: cyan is "normal", amber and
red are real warnings. Nothing glows unless it means something, so a red glow
on screen always indicates something that needs doing.

Type is Chakra Petch for display, Inter for body, and JetBrains Mono for all
figures and times, so numbers align in columns.

### The logo

**To use the real company artwork, drop the file into `public/` as
`logo.png`** (or `.svg`, `.webp`, `.jpg`). It is detected automatically and
replaces the typeset wordmark — no code change.

The supplied artwork is black-on-white, which would be invisible on a dark
interface, so `.logo-img` in `globals.css` inverts it and uses a `screen`
blend. That combination handles both a file with an opaque white background
and one with transparency; both have been tested and render as clean white
lettering with no visible box.

Until that file is added, `src/components/Wordmark.tsx` reproduces the mark in
CSS using Anton — a heavy condensed grotesque close to the original lettering
— laid out in the same structure: vertical "THE" beside a large "ROCK", over
"FACTORY." with a vertical "net".
