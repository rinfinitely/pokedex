-- Permanent account bans with reason. Safe to re-run.
-- Run in Supabase → SQL Editor after setup.sql.

alter table public.profiles
  add column if not exists ban_reason text not null default '';

comment on column public.profiles.ban_reason is 'Set by admins when banned=true; shown to the user on login attempt.';
