-- =====================================================================================================
-- GO Pokédex Tracker — database setup for the new features.
-- Run this ONCE in Supabase → SQL Editor. It is safe to run again (everything is "if not exists").
-- Requires the tables you already have: public.profiles (id, username, is_admin) and public.messages (id bigint, ...).
-- =====================================================================================================

-- helper used by several policies
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
$$;
grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- takes the username from the real profile so nobody can post under someone else's name
create or replace function public.stamp_username() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.username := coalesce((select p.username from public.profiles p where p.id = new.user_id), new.username);
  return new;
end $$;

-- ---------- 1. CLOUD-SYNCED POKÉDEX (private; only the owner can read or write their row) ----------
create table if not exists public.cloud_dex (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  dex        jsonb not null default '{}'::jsonb,
  trade      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.cloud_dex enable row level security;
drop policy if exists cloud_dex_owner on public.cloud_dex;
create policy cloud_dex_owner on public.cloud_dex for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop trigger if exists cloud_dex_touch on public.cloud_dex;
create trigger cloud_dex_touch before insert or update on public.cloud_dex for each row execute function public.touch_updated_at();

-- ---------- 2. PUBLIC PROFILE / LEADERBOARD / SHARED TRADE LISTS (visible only when the owner switches is_public on) ----------
create table if not exists public.trainer_cards (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  username   text not null default '',
  bio        text not null default '' check (char_length(bio) <= 160),
  team       text not null default '' check (team in ('', 'mystic', 'valor', 'instinct')),
  is_public  boolean not null default true,
  show_trade boolean not null default false,
  caught     int not null default 0 check (caught between 0 and 20000),
  total      int not null default 3484 check (total between 0 and 20000),
  pct        numeric(5,2) not null default 0 check (pct between 0 and 100),
  shiny      int not null default 0 check (shiny between 0 and 20000),
  special    int not null default 0 check (special between 0 and 20000),
  trade      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists trainer_cards_rank on public.trainer_cards (pct desc, caught desc) where is_public;
alter table public.trainer_cards enable row level security;
drop policy if exists trainer_cards_read on public.trainer_cards;
create policy trainer_cards_read on public.trainer_cards for select to anon, authenticated using (is_public or user_id = auth.uid());
drop policy if exists trainer_cards_write on public.trainer_cards;
create policy trainer_cards_write on public.trainer_cards for insert to authenticated with check (user_id = auth.uid());
drop policy if exists trainer_cards_update on public.trainer_cards;
create policy trainer_cards_update on public.trainer_cards for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists trainer_cards_delete on public.trainer_cards;
create policy trainer_cards_delete on public.trainer_cards for delete to authenticated using (user_id = auth.uid() or public.is_admin());
drop trigger if exists trainer_cards_touch on public.trainer_cards;
create trigger trainer_cards_touch before insert or update on public.trainer_cards for each row execute function public.touch_updated_at();
drop trigger if exists trainer_cards_name on public.trainer_cards;
create trigger trainer_cards_name before insert or update on public.trainer_cards for each row execute function public.stamp_username();

-- ---------- 3. FRIEND CODE BOARD (logged-in users only) ----------
create table if not exists public.friend_codes (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  username     text not null default '',
  code         text not null check (code ~ '^[0-9]{12}$'),
  trainer_name text not null default '' check (char_length(trainer_name) <= 24),
  team         text not null default '' check (team in ('', 'mystic', 'valor', 'instinct')),
  region       text not null default '' check (char_length(region) <= 40),
  note         text not null default '' check (char_length(note) <= 100),
  updated_at   timestamptz not null default now()
);
create index if not exists friend_codes_recent on public.friend_codes (updated_at desc);
alter table public.friend_codes enable row level security;
drop policy if exists friend_codes_read on public.friend_codes;
create policy friend_codes_read on public.friend_codes for select to authenticated using (true);
drop policy if exists friend_codes_insert on public.friend_codes;
create policy friend_codes_insert on public.friend_codes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists friend_codes_update on public.friend_codes;
create policy friend_codes_update on public.friend_codes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists friend_codes_delete on public.friend_codes;
create policy friend_codes_delete on public.friend_codes for delete to authenticated using (user_id = auth.uid() or public.is_admin());
drop trigger if exists friend_codes_touch on public.friend_codes;
create trigger friend_codes_touch before insert or update on public.friend_codes for each row execute function public.touch_updated_at();
drop trigger if exists friend_codes_name on public.friend_codes;
create trigger friend_codes_name before insert or update on public.friend_codes for each row execute function public.stamp_username();

-- ---------- 4. EVENTS & COMMUNITY DAY CALENDAR (everyone reads, admins write) ----------
create table if not exists public.events (
  id         bigint generated by default as identity primary key,
  title      text not null check (char_length(title) between 1 and 120),
  kind       text not null default 'event' check (kind in ('community_day', 'event', 'raid', 'spotlight', 'other')),
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  details    text not null default '' check (char_length(details) <= 2000),
  url        text not null default '' check (char_length(url) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists events_start on public.events (starts_at);
alter table public.events enable row level security;
drop policy if exists events_read on public.events;
create policy events_read on public.events for select to anon, authenticated using (true);
drop policy if exists events_admin on public.events;
create policy events_admin on public.events for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- 5. CHAT UPGRADES: replies + reactions ----------
alter table public.messages add column if not exists reply_to bigint references public.messages(id) on delete set null;

create table if not exists public.message_reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id    uuid   not null default auth.uid() references auth.users(id) on delete cascade,
  emoji      text   not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.message_reactions enable row level security;
drop policy if exists reactions_read on public.message_reactions;
create policy reactions_read on public.message_reactions for select to authenticated using (true);
drop policy if exists reactions_add on public.message_reactions;
create policy reactions_add on public.message_reactions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists reactions_remove on public.message_reactions;
create policy reactions_remove on public.message_reactions for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- ---------- 6. STREAM STATE removed (Twitch integration dropped) ----------
-- If you previously ran setup with stream_state, drop it in the SQL Editor:
--   drop table if exists public.stream_state cascade;

-- ---------- realtime ----------
do $$
declare t text;
begin
  foreach t in array array['message_reactions', 'events'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
             when undefined_object then null;
    end;
  end loop;
end $$;

-- ---------- OPTIONAL: first events, edit the dates before running ----------
-- insert into public.events (title, kind, starts_at, ends_at, details) values
--   ('Community Day', 'community_day', '2026-12-13 14:00:00-05', '2026-12-13 17:00:00-05', 'Featured Pokémon, bonuses and the exclusive move go here.');

