-- GO Pokédex Tracker — update script for this round of changes. Safe to re-run. Run it in Supabase → SQL Editor.
-- (Needs setup.sql and features.sql to have been run before, like everything else.)

-- 1. Profiles are ALWAYS public (there is no "public profile" switch any more).
--    Sharing trade lists (show_trade) is still opt-in.
alter table public.trainer_cards alter column is_public set default true;
update public.trainer_cards set is_public = true where is_public = false;      -- publishes the cards that were private
create or replace function public.force_public_card() returns trigger language plpgsql as $$
begin new.is_public := true; return new; end $$;
drop trigger if exists trainer_cards_always_public on public.trainer_cards;
create trigger trainer_cards_always_public before insert or update on public.trainer_cards
  for each row execute function public.force_public_card();

-- 2. Chat reactions were removed from the site. The table is no longer used; nothing breaks if you leave it.
--    To delete it and its data (optional):
-- drop table if exists public.message_reactions;

-- 3. Donation goal ← Patreon. After deploying the patreon-sync function (see SETUP-FEATURES.md → section 3), this checks Patreon every
--    10 minutes as a safety net (the Patreon webhook handles the instant updates). Fill in your project ref + CRON_SECRET, remove the dashes, run.
-- create extension if not exists pg_cron; create extension if not exists pg_net;
-- select cron.schedule('patreon-sync', '*/10 * * * *', $$
--   select net.http_post(url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/patreon-sync',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR_CRON_SECRET'), body := '{}'::jsonb) $$);

-- 4. The Events tab was removed. The events table is no longer used; nothing breaks if you leave it. To delete it (optional):
-- drop table if exists public.events;
-- If you ever scheduled the old event jobs, remove them (harmless if they don't exist):
-- select cron.unschedule('events-sync');
