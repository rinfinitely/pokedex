-- Run once in the Supabase SQL editor: removes the 200,000-character cap on avatar/banner images
do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname = 'public' and cl.relname = 'trainer_cards' and con.contype = 'c'
      and (pg_get_constraintdef(con.oid) ilike '%avatar_url%' or pg_get_constraintdef(con.oid) ilike '%banner_url%')
  loop
    execute format('alter table public.trainer_cards drop constraint %I', r.conname);
  end loop;
end $$;
