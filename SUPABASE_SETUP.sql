-- MontaJá V4 — sincronização iPhone <-> PC
-- No Supabase: SQL Editor > New query > cola tudo > Run.

create table if not exists public.montaja_data (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('job','client','history')),
  item_id text not null,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, item_id)
);

alter table public.montaja_data enable row level security;

drop policy if exists "montaja_select_own" on public.montaja_data;
create policy "montaja_select_own"
on public.montaja_data for select
using (auth.uid() = user_id);

drop policy if exists "montaja_insert_own" on public.montaja_data;
create policy "montaja_insert_own"
on public.montaja_data for insert
with check (auth.uid() = user_id);

drop policy if exists "montaja_update_own" on public.montaja_data;
create policy "montaja_update_own"
on public.montaja_data for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "montaja_delete_own" on public.montaja_data;
create policy "montaja_delete_own"
on public.montaja_data for delete
using (auth.uid() = user_id);

create index if not exists montaja_data_user_updated_idx
on public.montaja_data (user_id, updated_at desc);
