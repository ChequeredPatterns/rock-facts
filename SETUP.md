# Getting Rock Factory Central connected

Written for someone who has never written code. There is no terminal, no
installing anything, and nothing to break. Every step is filling in a web form.

---

## Part 0 — Put it online first (10 minutes, free)

This has to come first, because the Google sign-in needs a web address to
return to.

We use **Netlify**. It is free, and unlike some free hosting plans it permits
commercial projects, so there is nothing to pay and no terms problem for a
business tool. No credit card is needed.

1. Go to <https://app.netlify.com/signup> and sign up with **GitHub**.
2. Click **Add new site** → **Import an existing project**.
3. Choose **GitHub**, allow access, and pick the **`rock-facts`** repository.
4. **Change nothing.** The build settings are already in the project.
5. Click **Deploy**.

After a couple of minutes you get an address like
`https://something-random.netlify.app`. To make it tidier:
**Site configuration → Change site name**.

> **This is already done.** The site is live at
> <https://therockfactorycentral.netlify.app> — every address below is written
> out in full for it, so there is nothing to substitute. If the site is ever
> renamed, the addresses in Part 1 step 5 must be updated in Google Cloud
> Console to match, or the sign-in will break.

Open it now. The dashboard works immediately on clearly-labelled sample data,
so you have something real to show people before any keys exist.

> **Where settings go on Netlify:** everywhere below that mentions adding a
> variable, it means **Site configuration → Environment variables → Add a
> variable**. After adding any variable, go to **Deploys → Trigger deploy →
> Deploy site** for it to take effect.

---

## Part 0.5 — Decide who can see it (do this before any keys)

**A Netlify address is not private.** Every certificate issued for one is
published in the public Certificate Transparency logs, which are scraped
continuously, so "nobody knows the link" protects nothing.

Rock Factory Central handles this itself, at no cost — Netlify's own password
protection is a paid plan, and this does a better job anyway.

**How it behaves:**

| What is configured | What the site does |
|---|---|
| No connector keys | Open. Sample data only, so nothing to protect |
| Any real key, no way in configured | **Locks completely** |
| Any real key, a way in configured | Sign-in required |

The middle row is deliberate. The gate switches on the instant a credential
appears, so there is never a window where live client data sits on the open
internet because the login had not been set up yet. If it cannot let anyone
in at that moment it closes instead — staff being locked out is recoverable
and obvious; the whole internet being let in is neither.

**So set this first.** There are two ways in. Pick one.

### Option A — a shared password (simplest)

On Netlify add one variable:

- `SITE_PASSWORD` — the password everyone types

Also add `SESSION_SECRET`, set to any long random string. Without it the
session cookie is signed using the password itself, so a short password
means a weak signing key too. With it, cookies cannot be forged regardless.

Repeated wrong guesses from one address are locked out for fifteen minutes
after eight attempts, which blunts casual guessing. The real protection is
length: a short password has few combinations and a script can work through
them quickly. The lockout counters also live in the memory of whichever
serverless instance answered, so they are a genuine obstacle rather than a
guarantee.

Changing `SITE_PASSWORD` signs everybody out immediately.

### Option B — per-person Google sign-in (better for a business)

- `ALLOWED_EMAILS` — the Google addresses allowed to view, comma separated,
  e.g. `boss@therockfactory.co.nz,ops@therockfactory.co.nz`
- or `ALLOWED_EMAIL_DOMAINS` — a whole work domain, e.g.
  `therockfactory.co.nz`, to avoid listing people one by one

Use a domain you control. Never `gmail.com`, which would admit anyone on
earth with a Google account. This needs the Google credentials from Part 1
and the second redirect URI, so it is worth doing once that is set up.

A sign-in lasts fourteen days either way. Removing someone from
`ALLOWED_EMAILS` locks them out on their very next page load, without waiting
for that to expire — which is what you want the day someone leaves.

**Why B is better eventually:** a shared password cannot tell you who looked
at anything, and when one person should lose access it has to be changed for
everyone. Setting `ALLOWED_EMAILS` switches over with no code change; set
both and the sign-in page offers each.

The **Setup** page states plainly which of the three rows above you are
currently in, so you never have to guess whether the dashboard is public.

---

## Part 1 — Google (the only step needing the account owner)

Rock Factory Central asks for **read-only** access. It cannot send email,
change a calendar, or delete anything. Say that up front — it is usually the
thing that makes someone hesitate.

> **Which Google account?** Sign in as the account that actually holds the
> business calendars and mail. A brand-new empty account will connect
> perfectly and then show an empty timeline, which looks like a fault but is
> not. The Cloud project in steps 1–6 can be owned by any account you like;
> only the sign-in in step 9 has to be the one with the data.

### Steps 1–6: create the credentials (anyone can do this)

1. Go to <https://console.cloud.google.com/projectcreate>
2. Project name: `Rock Factory Central`. Click **Create**.
3. In the search bar at the top, search **Google Calendar API**, open it, click
   **Enable**. Do the same for **Gmail API**.
4. Search for **OAuth consent screen**.
   - User type: **Internal** if you have Google Workspace, otherwise **External**
   - App name: `Rock Factory Central`
   - Support email: yours
   - Click through the rest accepting defaults
5. Go to **Credentials** → **Create credentials** → **OAuth client ID**
   - Application type: **Web application**
   - Under **Authorised redirect URIs**, click Add and paste your address from
     Part 0 with `/api/auth/google/callback` on the end, exactly like this:

     Add **both** of these, one at a time:

     ```
     https://therockfactorycentral.netlify.app/api/auth/google/callback
     ```

     ```
     https://therockfactorycentral.netlify.app/api/auth/login/callback
     ```

     The first connects the business Google account once. The second is how
     staff sign in to view the dashboard. Both are needed.

     Copy them exactly as they are — already filled in for this site. They
     must match character for character: `https`, no trailing slash, no
     `www`. A mismatch here is the single most common failure, and the app
     will tell you if it happens.
6. Click **Create**. Copy the **Client ID** and **Client secret**.

### Steps 7–8: save them

7. On Netlify: **Site configuration** → **Environment variables**. Add:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
8. **Deploys** → **Trigger deploy** → **Deploy site**.

### Steps 9–11: the sign-in (30 seconds, needs the account owner)

9. Visit <https://therockfactorycentral.netlify.app/setup> and click
   **Sign in with Google**.
10. Sign in **as the account holding the business calendars** and approve.
11. The page shows a **refresh token**. Add it on Netlify as
    `GOOGLE_REFRESH_TOKEN`, then trigger a deploy.

That token is a password in all but name — it grants read access to that
account's calendar and mail. Don't email it or paste it into a chat. The page
deliberately isn't cached, so close it once saved.

### Step 12: choose the calendars

Go back to `/setup`. It now lists every calendar the account can see, each with
its ID. Copy the IDs of the ones holding client events into a variable called
`GOOGLE_EVENT_CALENDAR_IDS`, separated by commas, and trigger a deploy.

Optionally add `GOOGLE_CREW_CALENDARS` as `Name=calendarId` pairs if you keep a
calendar per crew member — it lets the dashboard show who is working even
before Connecteam is connected.

---

## Part 2 — Streak (2 minutes, no boss needed if you have Streak access)

1. Open Gmail with Streak loaded.
2. Click the Streak menu → **Integrations** → **API Key**.
3. Copy the key. That is `STREAK_API_KEY`.

You do not need to find the pipeline key by hand — once the API key is saved,
the **Setup** page in Rock Factory Central lists your pipelines and tells you
which value to use for `STREAK_PIPELINE_KEY`.

The account has three pipelines; the one the dashboard wants is
**Event Planning**. The other two (*3. SUPPLIERS* and *LEVERAGE and
IMPROVEMENT*) are not client jobs.

> ⚠️ Streak's API is on paid plans only. If the menu has no API Key option,
> that is the reason.

### If someone renames a Streak stage

The dashboard works out each job's status from the **name** of the stage its
box sits in, so renaming a stage can change what the dashboard shows. After any
rename, run:

```bash
npm run verify:streak
```

It prints every stage in the pipeline next to the status it maps to. Anything
marked `??` is no longer recognised and needs a rule adding to `STAGE_RULES` in
`src/lib/connectors/streak.ts`. Nothing else in the app needs to change.

Two mappings are judgement calls worth knowing about:

- **RELATIONSHIP BUILDING** and **OLD CLIENTS TRYING TO CONTACT** are treated
  as *not live jobs*, so they stay off the live board. If you would rather see
  them for follow-up, say so — it is a one-line change.
- **OUT (Awaiting Return) OR Awaiting payment still** counts as committed work
  that still needs chasing, so it stays **on** the live board.

---

## Part 3 — Connecteam (2 minutes, needs an owner account)

1. Sign in to Connecteam as the **owner** account.
2. **General Settings** → **API keys** tab → create a key.
3. Copy it. That is `CONNECTEAM_API_KEY`. Add it on Netlify and trigger a deploy.

### Then pick the scheduler

Connecteam needs a second value, `CONNECTEAM_SCHEDULER_ID`, which says *which*
schedule holds your crew shifts. **Connecteam does not show this ID anywhere in
its own screens**, so don't go hunting for it.

Once the API key above is saved and deployed, go to `/setup` in Rock Factory
Central. It lists every scheduler on the account with its ID, the same way it
lists your calendars. Copy the one holding crew shifts into
`CONNECTEAM_SCHEDULER_ID` — just one, not a comma-separated list — and trigger
a deploy.

> If you'd rather not wait for a deploy, `npm run verify:connecteam` prints the
> same list from a terminal. The Setup page exists so you never have to.

> ⚠️ Connecteam restricts API access to its higher-priced plans. If the **API
> keys** tab isn't there, that is the reason — and Rock Factory Central works
> fine without it, showing crew from the per-person Google Calendars instead.

---

## Part 4 — On Rent Events (5 minutes)

On Rent Events runs on **Current RMS**, so this uses the documented Current
RMS API. You need two things.

### The subdomain

Look at the web address when you are signed in to On Rent Events / Current
RMS. If it reads `https://rockfactory.current-rms.com`, your subdomain is
`rockfactory` — just that first part, not the whole address.

That is `ONRENT_SUBDOMAIN`.

### The API key

1. In Current RMS, go to **System Setup** → **Integrations** → **API**.
2. Generate a key and copy it.

That is `ONRENT_API_KEY`.

> ⚠️ **This key is more powerful than the others.** Current RMS API keys
> cannot be restricted to read-only — the key grants full read *and write*
> access to your rental system. Rock Factory Central only ever reads, and
> never sends a write request, but the key itself could do damage if it
> leaked. Keep it in the hosting platform's environment variables and nowhere
> else: not in a file, not in an email, not in a chat message.

### Checking it works

Once both values are saved, the Setup page will show On Rent Events as
connected. If anything is wrong, this reports exactly what:

```bash
npm run verify:onrent
```

It also lists the opportunity status names your business actually uses, which
is worth passing on — the dashboard has to translate those into its own
pipeline stages, and every company words them differently.

---

## Part 5 — Putting the values in (5 minutes, once)

1. Go to your site on <https://app.netlify.com> → **Site configuration** →
   **Environment variables**.
2. For each value you collected, click **Add a variable**: the name on the
   left, the value on the right. Save.
3. Go to **Deploys** → **Trigger deploy** → **Deploy site**.

Names to use are listed in `.env.example`, and the **Setup** page inside the app
shows you exactly which ones are still missing at any time.

**You do not have to do all of them at once.** Connect Google first — that alone
gives you a working timeline. Add the others whenever you get the keys. Anything
not connected simply shows as "not connected"; nothing breaks.

---

## The one habit worth adopting

These five systems share no common ID, so Rock Factory Central matches records
by client name, email and date. That works well, but it is guesswork at the
margins — and you will occasionally see a "Match unconfirmed" warning.

If the team starts putting the **same job number in all three places** — the
On Rent quote, the Streak box name, and the calendar event title — like:

```
RF-1042 Harbourside Weddings
```

...then matching becomes exact, the warnings disappear, and nothing can be
mismatched or missed. It costs nothing and it is the single highest-value change
you can make to how the dashboard performs.

---

## Appendix — Running it on your own computer instead

You do not have to use a hosting company. The app runs perfectly well on an
office computer, and this has been tested. Here is the honest comparison
before you choose.

### What it costs you

| | Netlify (free) | Your own computer |
|---|---|---|
| Money | Free | Free |
| Setup | Click through a signup | Install Node.js, run a command |
| Starting it | Always on | Someone starts it; machine must stay awake |
| Who can see it | Anyone with the link | Only people on the office wifi |
| On site / at a venue | Works on any phone | Does not work |
| Getting updates | Automatic when I push | Someone runs `git pull` |

The money argument is gone — both are free — so the real question is whether
anyone needs the dashboard when they are **not** in the office. For a business
whose staff are out at venues, "is Saturday crewed?" is usually asked away
from a desk. That is the deciding factor, not cost.

### One thing worth being clear about

Running locally does **not** keep your business data in-house. The data already
lives in Google, Streak, On Rent Events and Connecteam — all cloud services.
This dashboard only reads it. So "local" is about convenience, not privacy.

### If you want to run it locally anyway

1. Install **Node.js 22** from <https://nodejs.org> (the big green button).
2. Download this project: on the GitHub page, **Code → Download ZIP**, and
   unzip it.
3. Open Terminal (Mac) or Command Prompt (Windows) and type `cd ` followed by
   a space, then drag the unzipped folder onto the window and press Enter.
4. Run these two commands, one at a time:

```bash
npm install
```

```bash
npm run build
```

5. Create a file called `.env.local` in that folder and put your keys in it,
   one per line, using the names from `.env.example`:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

6. Start it:

```bash
npm start
```

7. Open <http://localhost:3000>.

**To let others in the office use it**, start it with this instead, then share
the "Network" address it prints:

```bash
npx next start -H 0.0.0.0
```

**For the Google sign-in locally**, register this as the authorised redirect
URI in Google Cloud Console — Google permits `http` for localhost
specifically, so this works without a certificate:

```
http://localhost:3000/api/auth/google/callback
```

Nothing is lost by starting locally and moving to hosting later. It is the
same app and the same keys; only the redirect URI changes.
