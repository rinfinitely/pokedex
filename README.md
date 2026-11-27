# GO Dex & Trade
Static site: open `index.html` (or `python3 -m http.server`).
Database: if not already done, run `supabase/setup.sql` then `supabase/features.sql` in the Supabase SQL Editor (safe to re-run).
For realtime chat, make sure the `messages` table is in the `supabase_realtime` publication.
Cloud data is saved under a `goDexV1` key inside `cloud_dex`, so your old site's data in that row is left intact.
