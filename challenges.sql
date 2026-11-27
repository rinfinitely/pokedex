-- Challenges + follows for GO Pokédex Tracker
-- Run after setup.sql and features.sql

-- Follows
create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists follows_following on public.follows (following_id);
alter table public.follows enable row level security;
drop policy if exists follows_read on public.follows;
create policy follows_read on public.follows for select to anon, authenticated using (true);
drop policy if exists follows_write on public.follows;
create policy follows_write on public.follows for insert to authenticated with check (follower_id = auth.uid());
drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows for delete to authenticated using (follower_id = auth.uid());

-- Challenges
create table if not exists public.challenges (
  id text primary key,
  title text not null,
  description text not null default '',
  target int not null,
  metric text not null check (metric in ('shiny','special','pct','caught')),
  badge_id uuid references public.badges(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.challenges enable row level security;
drop policy if exists challenges_read on public.challenges;
create policy challenges_read on public.challenges for select to anon, authenticated using (active or public.is_admin());
drop policy if exists challenges_admin on public.challenges;
create policy challenges_admin on public.challenges for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Seed a few challenges (badge_id null until you link real badges)
insert into public.challenges (id, title, description, target, metric, active) values
  ('shiny10', 'Shiny Spark', 'Register 10 shinies', 10, 'shiny', true),
  ('shiny25', 'Shiny Hunter', 'Register 25 shinies', 25, 'shiny', true),
  ('shiny50', 'Shiny Starter', 'Register 50 shinies', 50, 'shiny', true),
  ('shiny100', 'Shiny Specialist', 'Register 100 shinies', 100, 'shiny', true),
  ('shiny250', 'Shiny Master', 'Register 250 shinies', 250, 'shiny', true),
  ('shiny500', 'Shiny Legend', 'Register 500 shinies', 500, 'shiny', true),
  ('caught100', 'First Century', 'Register 100 species', 100, 'caught', true),
  ('caught250', 'Quarter Dex', 'Register 250 species', 250, 'caught', true),
  ('caught500', 'Dex Dedication', 'Register 500 species', 500, 'caught', true),
  ('caught750', 'Dex Devotee', 'Register 750 species', 750, 'caught', true),
  ('caught1000', 'Living Dex', 'Register 1000 species', 1000, 'caught', true),
  ('special50', 'Form Finder', '50 special registrations', 50, 'special', true),
  ('special100', 'Form Collector', '100 special registrations', 100, 'special', true),
  ('special250', 'Form Curator', '250 special registrations', 250, 'special', true),
  ('special500', 'Form Encyclopedia', '500 special registrations', 500, 'special', true),
  ('pct50', 'Halfway There', 'Reach 50% Pokédex completion', 50, 'pct', true),
  ('pct75', 'Three Quarters', 'Reach 75% Pokédex completion', 75, 'pct', true),
  ('pct90', 'Almost There', 'Reach 90% Pokédex completion', 90, 'pct', true),
  ('pct100', 'Dex Complete', 'Reach 100% Pokédex completion', 100, 'pct', true)
on conflict (id) do nothing;

-- Optional: after creating milestone badges in Badge manager, link them:
-- update public.challenges set badge_id = '<badge-uuid>' where id = 'shiny50';
