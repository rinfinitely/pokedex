# Changes (fixed version)
Base: your original pokedex-main. The extra "Social hub" from background.zip (social.js / social.css / social.sql) is NOT included.

1. Social → "Find trainers": trainers are no longer listed. You must type a username (2+ chars); results come from a
   live `ilike` query on public trainer_cards (max 30), sortable by completion / registered / shinies. Enter opens the first result.
   The search box no longer loses focus while typing.
2. Trading → new "Matches" tab (next to "My lists") with a count badge. Filters: All / Two-way / Have what I want /
   Want what I offer, sort by Best match / Most Pokémon, and the Looking for / Offering pickers live in that tab.
3. Cache versions bumped (index.html, sw.js) so browsers pick up the new files.
Files changed: extras.js, features.css, index.html, sw.js.

# Restyle (this zip only)
New file theme.css (linked last in index.html, precached in sw.js). Remove the <link> to revert.
- Site-wide: flat near-black PGTrade-style UI (cards, pill filters, trading columns, match cards, modals, chat), indigo accent.
- Profiles, badges, clan tags, leaderboard: Krunker Social style (slab with red top edge, square avatar, [CLAN] tags,
  uppercase stat tiles, flat 3D buttons, red follow button, leaderboard strips).

# Social / Trading rework
- Social: Trade board removed. "Find trainers" only searches when Enter is pressed (typing no longer queries). Result cards (.socCard) now show banner, avatar, team, badges, clan tag, name colour, completion bar, bio and trade status. Images/badges load after the text so results appear instantly.
- Trading → My lists: modal picker replaced by two inline pickers (For Trade on top, Looking For below) with search, filter chips and a scrolling tile grid. Quantities & notes live in a collapsible section.
- Trading → Matches: Mutual / I Have / I Want tabs, Filters (sort, team), trainer cards with avatar, friend code, badges, Message button, ⋮ menu, For Trade / Looking For tile panels with matches highlighted, "Show N more", and the trainer's bio as a note.
- New file pgtrade.css (linked after theme.css, precached). Cache versions bumped.
Files changed: app.js, extras.js, index.html, styles.css, theme.css, features.css, sw.js, pgtrade.css (new).

# Trade pair popup + instant search
- Social → Find trainers: 1 character minimum, results appear as you type (no Enter needed). Finished searches are cached and longer queries are filtered locally, so repeat/narrowing searches are instant; previous results stay on screen while a new query loads.
- Trading: the inline pickers are replaced by a "Create Trade Pair" button that opens a popup containing For Trade, Looking For, an optional note (200 chars) and Create / Cancel at the bottom. Cancel / ✕ / Esc / clicking outside reverts any changes made in the popup.
- Picker grids render synchronously (no waiting on images) and are pre-built at page load, so the popup opens instantly.
- Note is stored on trade.note.
Files changed: index.html, app.js, extras.js, pgtrade.css, sw.js.

# Separate pages + list generator
- Every tab is now its own page with a real URL (History API, back/forward work, page title changes): /dex (alias /pokedex), /dashboard, /matches, /list-generator (alias /list), /community, /codes, /suggestions, /social. Old /trade → /dashboard. Added the new paths to vercel.json.
- "Trading" is split into three top-level tabs: Dashboard (trade pair), Matches (own page, count badge on the tab) and List Generator.
- Dashboard: the Create/Edit popup now works on a draft. Nothing appears on the dashboard (or is saved/synced) until you press Create/Save; Cancel, ✕, Esc discard it.
- List Generator (new): Looking For / For Trade preview card with Can Fly toggle, background themes, note, Download PNG (uses the existing image exporter, themed), Share link, Saved Lists, per-section copy-as-text and edit.
- Social search: avatar/banner URLs come back in the same query as the username (no second round trip), images are pre-downloaded, and the top 200 trainers are pre-fetched so most searches paint with pictures immediately.
Files changed: index.html, app.js, extras.js, features.js, features.css, pgtrade.css, sw.js, vercel.json.

# List generator artwork
- Uses the supplied pokéball, "Looking For" / "For Trade" title images and fly icon (lg-*.png), on the card and in the PNG export.
- Trinket button + dialog (per-section toggles, not saved) showing a trinket icon next to the section title, also in the PNG.
- T / pencil buttons restyled to match the reference.
- Pokéball in the list generator is now the Master Ball image.

# Batch 1 — extra tracker tools (more.js / more.css)
New files: more.js, more.css. Small edits: app.js (exposes a few helpers on window.PDX: setTab, genProgress, tabTotals, isUnreleased, genFor; variant tab titles), index.html (loads more.css / more.js, app.js ?v bumped), sw.js (cache version, precaches more.css).
No database changes — everything below is stored in this browser (localStorage keys start with "pdx.more.").
New "extras" panel under the filter bar on the Pokédex page:
- #1  Bulk select: click cards (Shift-click = range), "Select all shown / missing", then Mark / Unmark the tab's Owned box or a species flag (caught, shiny, shadow, purified, lucky, hundo, nundo, XXL, XXS). Undo button after each action. Syncs to the cloud like normal ticks.
- #3  Missing lists per generation (progress bar, "Show missing" filter jump, "Copy list" as text).
- #5  Dex mode: National (all form/costume cards) vs Living (one card per species).
- #6  Form-family progress: every species with several forms, X/Y owned, chips per form, search.
- #7  Regional form filter: Alolan / Galarian / Hisuian / Paldean.
- #9  Completion bars for Mega / Dynamax / Gigantamax (+ shiny versions) and every other variant (Progress & titles).
- #11 XXL / XXS tracking (and Shadow, Purified, Lucky, Hundo, Nundo, Mega, Dynamax, Gigantamax, Costume): "Track" menu opens those tabs, which existed in the code but had no buttons.
- #21 Trophy case (up to 24 rare catches with kind, date and note; shown on a shelf under the tools).
- #30 Availability filter: All / Released / Not yet released.
- #84 Titles (Shiny Hunter, Collector, Dex Master…) unlocked from your numbers; equip one; toast when a new one unlocks.
- #122 Event countdown strip under the tab bar (next 3 events, LIVE state) — events are added by you in ⏰ Events.
- #141 Calendar export (.ics) per event or all upcoming events, with a 30-minute reminder.
- #161 Automatic backup snapshots (about once a day, last 7, compressed) with Download / Restore (a safety copy is taken before restoring).
- #165 Site health: local error log + real-user load timings (first byte, content ready, largest paint, fully loaded) and a "Copy report" button.
- #171 Sparkle animation + golden glow when you tick a shiny (can be switched off in Skin).
- #179 Seasonal skins: GO Fest, Halloween, Holidays, Spring, or Auto by season.
- #70  Welcome message the first time someone signs in on a browser.
- #102 Skeleton placeholders on pages that load with JavaScript (Community, Friend codes, Suggestions, Social, Admin) — pure CSS, disappears when the page fills in.

# Batch 2 (2026-11-06)
Added client-side features in more.js / more.css (still no database changes; localStorage keys under "pdx.more.").
- #8  Costume checklist: 🎩 Costumes button opens a grouped list of costume forms with best-effort event name + year from sprite stems, owned chips, search, and jump to the Costume track tab.
- #47 Showcase 6 Pokémon: ⭐ Showcase button lets you pick up to 6 caught species; they appear as a shelf under the tools on the Pokédex page (this browser).
- #86 Badge showcase frames: in 🎨 Skin, choose Gold / Silver / Rainbow / Shadow frames that wrap badges on the Badges page and profiles.
- #163 Service worker: image cache bumped (v3), path matcher broadened, shell cache version updated so sprites and static assets stay cached offline more reliably.
Files: more.js, more.css, sw.js, index.html (cache-busters), CHANGES.md.

# Batch 3 (2026-11-06)
- #29  Availability filter label: **In GO** (released species already in Pokémon GO) / Not yet — same logic as before, clearer name for “currently available”.
- #74  Community events **calendar**: month grid in ⏰ Events (prev/next/today, dots for event days, click a day to pre-fill the add form). List + .ics export unchanged.
- #76  **Seasonal tracks** in Progress & titles (Spring / Summer / Fall / Winter goals for caught, shiny, special counts).
- #78  **Badge rarity %**: badge detail modal now shows holders count and rarity % vs public trainer cards (Common → Legendary labels).
- #164 Edge caching: `vercel.json` Cache-Control headers for static assets (long cache) and index.html / sw.js (revalidate).
Files: more.js, more.css, features.js, vercel.json, sw.js, index.html, CHANGES.md.

# Batch 4 (2026-11-06)
- #126 **Temporary bans** (24h / 7d / 30d / permanent): Insights → Moderation user lookup has a “Ban for” duration. Stores `banned_until` on profiles. Unban clears it. Run `batch4.sql` once.
- #135 **Announcement scheduling**: Insights → Settings → Send an announcement accepts an optional datetime. Scheduled items are stored in `site_settings.scheduled_announcements` and sent when an admin next opens Insights (due items fire then). Cancel from the Upcoming list.
- #79 **Leaderboard seasons**: Community leaderboard chips — All time / This month / 90 days (filters by trainer card `updated_at`).
- #46 **Profile themes**: trainer card form has a theme select (Indigo / Rose / Forest / Sunset / Midnight). Applied on the public profile shell. Needs `batch4.sql` for the `profile_theme` column (graceful if missing until you run it).
Files: features.js, extras.js, theme.css, batch4.sql (new), index.html, sw.js, CHANGES.md.

# Batch 5 (2026-11-06)
- #58 **Profile views counter**: increments via `bump_profile_views` when someone opens a public profile (not self). Shown in profile Details.
- #59 **Custom profile URL slug**: optional slug on trainer card; `/u/slug` resolves before username. Unique when set.
- #127 **Ban appeals form**: banned users get “Submit an appeal” on login error; `submit_ban_appeal` RPC works while signed out. Admins see open appeals in Insights → Moderation (Accept = unban / Reject).
- #134 **Role tiers (mod vs admin)**: `profiles.is_mod`. Admins can “Make mod / Remove mod” in user lookup. Mods see Admin → Moderation only (not analytics/settings/badge manager).
- #137 **Metrics dashboard labels**: Analytics stats clarified as DAU (24h) and chat volume / retention signal (existing RPC data).
Run **batch5.sql** once in Supabase.
Files: batch5.sql (new), extras.js, features.js, chat.js, index.html, sw.js, CHANGES.md.

# Batch 6 (2026-11-06)
- #49 **Follower feed**: Social page shows a Following feed — recent public updates from people you follow (activity_events when available, otherwise trainer card updates).
- #54 **Profile privacy controls**: trainer card options to hide shiny count, completion %, badges on profile, and hide from leaderboard (profile stays public).
- #68 **@mention → inbox**: chat @mentions create in-app notifications for the mentioned user.
- #146 **Share shiny moments**: after marking a shiny, a toast offers Share (Web Share API or copy text).
Run **batch6.sql** once (privacy columns + activity_events table).
Files: batch6.sql (new), extras.js, features.js, chat.js, more.js, index.html, sw.js, CHANGES.md.

# Hotfix 2026-11-06g
- Fix `pdx.entry is not a function` (Showcase / Costumes) by exposing `entry` on `window.PDX` and using a safe `dexEntry` helper in more.js.
- Stop wiping Pokédex progress for species treated as “unreleased”; soft `isUnreleased` so missing sprites no longer drop gen totals (e.g. Kanto 136/151).
- Events tab: auto-load from **ScrapedDuck** (LeekDuck data) with image, name, type, dates; session cache for instant paint; refresh button; DB fallback.
Files: app.js, more.js, extras.js, features.css, index.html, sw.js.

# Batch 7 — UI cleanup (part 1)
- Removed the Standard/Location/Special + Shiny tab rows; Location Background / Special Background (and Shiny versions) now live in the Track list. Every Track tab has an icon.
- Tools row reduced to a single "Progress" button (titles removed).
- Shadow/Lucky aura is clipped to the sprite box so it no longer covers the Pokémon's name.
- XXS sprites scaled up (0.45 → 0.68).
- XXL / XXS / Hundo / Nundo / Purified cards now have their own badge, border and glow.
- Availability "Not yet" → "Unreleased"; filter now works per generation 1-9 (data-level, not DOM-level).
- Events: full-width cards, details on the far right, spaced-out filter tabs.
Files: app.js, more.js, more.css, styles.css, index.html, sw.js, CHANGES.md.

# Batch 7 — part 2
- Deleted (not hidden) the old Standard/Location/Special + Shiny tab rows: markup, handlers and CSS. Track list drives tab switching via PDX.setTab (fires `pdx:tab`).
- Track list redesigned: each normal/shiny pair is one pill, rows wrap cleanly.
- Removed the Events tab (nav button, view, routes, ScrapedDuck loader, CSS). The personal countdown strip is untouched.
- Removed the frames around XXL/XXS sprites and the glow on Hundo/Nundo sprites (badges + card borders stay).
- Shadow aura redrawn in CSS (soft purple smoke) instead of the blurry 93px PNG.
- "Registered species" max now = every card on every Track tab (normal + shiny), released species only, matching the cards actually shown. Per-tab lists are cached so saving stays fast.
- Species with no sprite are now treated as unreleased everywhere (locked cards, excluded from totals/progress).
- XXS scale 0.74.

# Batch 7 — part 3
- Track list is a strict 3-column grid: every normal/shiny pair is the same width, rows line up (2 columns <1000px, 1 <600px).
- Filter panel + Availability/Track/Progress are now ONE panel.
- Shadow aura: new crisp 4x upscale of the original flame art (shadow-aura.png, v=2). Removed the embedded duplicate image that was stacking under it (the cause of the blur) and the CSS-smoke experiment.
- "Registered species" box tooltip lists owned/total for every tab; total is unchanged (sum of all cards on all 32 tabs).

# Location background names
- Location/Special background file names are turned into readable labels: `10th_Anniversary_Times_Square.png` shows as "10th Anniversary, Times Square".
  Underscores/spaces become spaces, lowercase words are capitalised (FC, NPB, 10th, Poké keep their case), and a comma is added after the event part
  (Anniversary, Festival, Go Fest, Go Tour, Community Day, Safari Zone, Night Out, Wild Area, Comic Con, Expo, Poké Lid ...) when a place follows it.
  To choose the comma yourself, put a double underscore in the name: `Wild_Area__Mexico_City_2026.png` -> "Wild Area, Mexico City 2026".
  To add more event words, edit BG_EVENT_RE in app.js. Ownership keys are unchanged (only the displayed label differs).
Files changed: app.js, index.html, sw.js (cache versions bumped), CHANGES.md.
