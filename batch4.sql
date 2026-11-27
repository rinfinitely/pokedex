-- Batch 4 schema additions. Safe to re-run in Supabase → SQL Editor.

-- #126 Temporary bans
alter table public.profiles
  add column if not exists banned_until timestamptz;

comment on column public.profiles.banned_until is
  'When set with banned=true, the ban expires at this time (null = permanent).';

-- #46 Profile themes (optional accent key stored on the public trainer card)
alter table public.trainer_cards
  add column if not exists profile_theme text not null default ''
  check (char_length(profile_theme) <= 40);

comment on column public.trainer_cards.profile_theme is
  'Optional profile shell theme key: default, indigo, rose, forest, sunset, midnight.';
