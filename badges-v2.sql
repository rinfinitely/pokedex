-- Badges v2: Patreon-tier badges.  Run ONCE in Supabase -> SQL Editor (safe to re-run).
-- Adds two optional columns to public.badges. Existing badges are not changed.
alter table public.badges add column if not exists source text not null default 'manual' check (source in ('manual', 'patreon'));
alter table public.badges add column if not exists tier   text not null default '' check (char_length(tier) <= 60);
