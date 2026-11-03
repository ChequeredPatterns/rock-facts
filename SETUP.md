# Getting Rock Factory Central connected

Written for someone who has never written code. There is no terminal, no
installing anything, and nothing to break. Every step is filling in a web form.

---

## Part 1 — The one thing that needs the boss (about 4 minutes)

Only Google genuinely needs the account owner, because it is her Google account
that holds the calendars and the mail. Everything else can be done by anyone
with admin access to the product.

**Do this part while sitting with her. It is one screen.**

Rock Factory Central asks for **read-only** access. It can never send an email,
change a calendar, or delete anything. That is worth saying out loud, because
it is usually the thing that makes someone hesitate.

### What she actually has to do

1. Go to <https://console.cloud.google.com/projectcreate>
2. Project name: `Rock Factory Central`. Click **Create**.
3. In the search bar at the top, search **Google Calendar API**, open it, click
   **Enable**. Do the same for **Gmail API**.
4. Search for **OAuth consent screen** in the top search bar.
   - User type: **Internal** if you have Google Workspace, otherwise **External**
   - App name: `Rock Factory Central`
   - Support email: hers
   - Click through the rest, accepting defaults, then **Back to dashboard**
5. Go to **Credentials** → **Create credentials** → **OAuth client ID**
   - Application type: **Web application**
   - Authorised redirect URI: `https://developers.google.com/oauthplayground`
   - Click **Create**
6. A box appears with a **Client ID** and a **Client secret**.
   **Copy both and send them to whoever is setting this up.**

That is her part finished. She does not need to be present for anything else.

### Then (anyone can do this bit)

7. Go to <https://developers.google.com/oauthplayground>
8. Click the gear icon (top right) → tick **Use your own OAuth credentials** →
   paste the Client ID and Client secret.
9. In the left-hand list, paste these two scopes into the
   "Input your own scopes" box, one at a time:
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/gmail.readonly`
10. Click **Authorise APIs**, sign in **as the boss's account** (she may need
    to type her password here — this is the only other moment she is needed,
    and it is 10 seconds).
11. Click **Exchange authorisation code for tokens**.
12. Copy the **Refresh token**. It is a long string starting with `1//`.

You now have the three Google values:
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.

---

## Part 2 — Streak (2 minutes, no boss needed if you have Streak access)

1. Open Gmail with Streak loaded.
2. Click the Streak menu → **Integrations** → **API Key**.
3. Copy the key. That is `STREAK_API_KEY`.

You do not need to find the pipeline key by hand — once the API key is saved,
the **Setup** page in Rock Factory Central lists your pipelines and tells you
which value to use for `STREAK_PIPELINE_KEY`.

> ⚠️ Streak's API is on paid plans only. If the menu has no API Key option,
> that is the reason.

---

## Part 3 — Connecteam (2 minutes, needs an owner account)

1. Sign in to Connecteam as the **owner** account.
2. **General Settings** → **API keys** tab → create a key.
3. Copy it. That is `CONNECTEAM_API_KEY`.

> ⚠️ **Check this before anyone pays for anything.** Connecteam restricts API
> access to its higher-priced plans, and the published information disagrees on
> which one — their help centre says Enterprise, a third-party review says the
> Expert tier. Ask Connecteam support directly which plan includes API access
> and what it costs. If the answer is expensive, say so: Rock Factory Central
> works perfectly well without Connecteam, it just shows crew from the per-person
> Google Calendars instead, which you already have for free.

---

## Part 4 — On Rent Events (unknown — needs one email)

This one could not be finished during the build, and it is worth being straight
about why: the build environment could not reach On Rent Events' website, so
there was no way to confirm how their API works. Rather than guess and have it
fail confusingly later, the connector is built but deliberately switched off.

**Send On Rent Events support this email:**

> Hi,
>
> We're building an internal dashboard and would like to pull our quote data
> out of On Rent Events automatically. Could you point us at your API
> documentation, and confirm:
>
> 1. The API base URL for our account
> 2. How we authenticate (API key? Which header?)
> 3. The endpoint that lists quotes/bookings, and how to filter it by date
> 4. Which fields hold the client name, client email, event date, total value
>    and quote status
>
> Thanks!

When they reply, pass the answer on and this connector becomes about twenty
minutes of work. Everything else is already built around it.

---

## Part 5 — Putting the values in (5 minutes, once)

1. Go to your project on <https://vercel.com> → **Settings** →
   **Environment Variables**.
2. For each value you collected, add a row: the name on the left, the value on
   the right. Click **Save**.
3. Go to the **Deployments** tab and click **Redeploy** on the most recent one.

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
