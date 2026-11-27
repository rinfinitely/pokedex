# What's new + how to switch it on

Everything is in the same static site (upload the folder as before). The new online features need **one SQL script**.

## 1. Database (required for all online features)
Supabase → SQL Editor → paste `supabase/setup.sql` → Run. Safe to re-run.
Until you do, each feature shows a "run supabase/setup.sql" notice instead of breaking.

## 2. First events
Log in as an admin → Events tab → "＋ Add event". (A commented example is at the bottom of setup.sql.)

## Files
New: `extras.js`, `manifest.webmanifest`, `icon-192/512/maskable-512.png`, `supabase/setup.sql`.
Changed: `index.html`, `app.js` (small bridge + change events), `chat.js` (replies, emoji, @mentions, formatting, new-message pill), `sw.js`, `styles.css`.
