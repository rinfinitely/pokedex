# New features — how to switch them on

Upload the folder as before (new files: `features.js`, `features.css`, `supabase/features.sql`, `supabase/update-nov.sql`, edge functions incl. `patreon-sync`; changed: `index.html`, `extras.js`, `sw.js`).
Nothing breaks if you skip a step — each feature shows a "run features.sql" notice until its part is set up.

## 1. Database (needed for everything below)
Supabase → SQL Editor → run `supabase/setup.sql` (already done), then **`supabase/features.sql`**, then **`supabase/badges-v2.sql`** (adds the Patreon-tier badge label), then **`supabase/update-nov.sql`** (profiles always public). All are safe to re-run.
This adds: badges (+16 starter milestone badges), notifications inbox, push subscriptions, site settings (donation goal), event-import columns,
moderation tables (mutes, blocked words, mod log, content reports), the chat guard trigger (mutes / blocked words / slow mode) and the analytics function.

## 2. Badges
Open **📊 Insights → 🏅 Badge manager** (admin), or use **＋ New custom badge** at the top of the Badges tab.
A badge has a name, a **type** and an uploaded image:
- **Milestone** — earned automatically when a trainer’s numbers reach the “Earned when … is at least …” rule (species registered, completion %, shinies, special registrations, trade-list size, friend code posted).
- **I award it** — you give it out by username (Insights → Badge manager → Award).
- **Patreon tier** — same as above, with a tier name shown on the badge (make one badge per tier, e.g. “Gold · $10/month”). The site can’t see Patreon, so you award these by hand.
Images are upload-only: the file is shrunk to 128×128 and stored inside the badge, so it can’t disappear later.

## 3. Donation goal bar (updates itself from Patreon)
Insights → ⚙ Settings → *Donation goal bar*: set the title, goal and link, tick "Show the bar" and leave **"Update raised so far automatically from Patreon"** ticked.
The `patreon-sync` function then adds up your Patreon members and writes the total into the bar; every open page updates live. One-time setup:
1. Patreon → https://www.patreon.com/portal/registration/register-clients → create a client (any name / redirect URL) → copy its **Creator's Access Token**.
2. `supabase secrets set PATREON_ACCESS_TOKEN=... CRON_SECRET=<same one as the other functions>`
   Optional: `PATREON_CAMPAIGN_ID=...` (found automatically if you have one campaign) and `PATREON_GOAL_MODE=lifetime` (see below).
3. `supabase functions deploy patreon-sync --no-verify-jwt`
4. Press **Sync from Patreon now** in the settings to check it works (it shows the total or the error).
5. Instant updates: Patreon developer portal → *Webhooks* → add `https://<ref>.supabase.co/functions/v1/patreon-sync`, tick the **members:pledge:create / update / delete** triggers, then
   `supabase secrets set PATREON_WEBHOOK_SECRET=<the secret Patreon shows for that webhook>`.
6. Safety net: un-comment the `patreon-sync` schedule in `supabase/update-nov.sql` (every 10 minutes) and run it.
**What is counted.** `monthly` (default): the total of what active patrons currently pledge per month — the right number for a "monthly hosting" goal. `lifetime`: everything every member has ever paid, which you'd use for a one-off goal.
Patreon's API reports members' pledges and payments; it has no feed of Patreon shop/one-time purchases, so those are only counted if Patreon includes them in a member's lifetime support. Money that comes through Cash App can't be seen by the site.
Untick the automatic option any time to type the number in by hand again.

## 4. Push notifications + 🔔 inbox + match alerts
1. Create keys once: `npx web-push generate-vapid-keys`
2. `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com SITE_URL=https://your-site/`
3. `supabase functions deploy push-notify --no-verify-jwt`
4. Paste the **public** key in Insights → Settings → *Push notifications* → Save key.
5. Un-comment the `push-notify` cron block in `features.sql` (every 5 minutes) and fill in project ref + CRON_SECRET.
6. Each person: 🔔 (top right) → *Turn on push* → *Send test notification*.
Sends: new two-way trade matches (max 3 per run, once a week per trainer), and admin announcements.
iPhone/iPad: push only works from the installed Home Screen app (iOS 16.4+).
Match alerts also run inside the site while it's open (Trading tab → Match alerts: two-way only or any overlap).

## 5. Moderation + analytics
Insights → 🛡 Moderation: report queue (chat messages, friend codes, profiles — friend codes and profiles now have a 🚩 Report button), user lookup (mute / ban / wipe messages / remove leaderboard card or friend code),
muted list, blocked words, slow mode, and an audit log of every action. Admins are never filtered or slowed.
Insights → 📈 Analytics: accounts, activity, chat volume, completion, top wanted/offered Pokémon, teams, most-earned badges.

## Background image / video (Insights → Settings)
Run `background-storage.sql` once in the Supabase SQL Editor. It creates a public `site-assets` Storage bucket that only admins can write to.
Uploads go to Storage and only the short URL is saved in `site_settings` — saving the video itself in that row caused “canceling statement due to statement timeout”.
Accepts MP4/WebM video or PNG/JPG/WebP/GIF image. The site doesn't limit size; Supabase's project-wide limit does (50 MB on free; raise it in Storage → Settings on a paid plan). Old files are deleted when you replace or clear the background.

## Things worth knowing
- The Trading tab’s “Trading costs” panel shows the Stardust cost chart (`trade-cost-chart.png`, click it to enlarge). To update it if Niantic changes costs, replace that image file and bump the `?v=` number in `features.js`.
- Profiles are always public: there is no “public profile” switch. A trainer card is created the first time someone logs in (trade lists stay private until shared). `supabase/update-nov.sql` publishes the cards that were private and adds a database trigger so none can be hidden again.
- The Events tab (calendar, event import, event reminders) has been removed. The leftover `events` table and the `events-sync` function are no longer used; see `update-nov.sql` for the optional clean-up.
- Insights loads instantly like the Admin tab: its data is fetched when an admin logs in, each sub-tab paints from memory, and a background refresh only redraws if something changed.
- Chat reactions were removed; the unused `message_reactions` table can stay or be dropped (see `update-nov.sql`).
- Milestone badges and the leaderboard are honor-system (the numbers come from the browser). If you ever want them tamper-proof, they'd need to be computed on the server from the synced dex.
- Not run against a live Supabase project from here (no network in my sandbox) — please test the SQL and both functions on a copy or a quiet moment first.
