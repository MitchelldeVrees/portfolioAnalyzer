-- Research experience supporting tables

-- Watchlist items scoped per user for research tab personalization
create table if not exists public.research_watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  label text,
  notes text,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

alter table public.research_watchlist enable row level security;

create unique index if not exists research_watchlist_user_ticker_idx
  on public.research_watchlist (user_id, upper(ticker));

create index if not exists research_watchlist_created_idx
  on public.research_watchlist (user_id, created_at desc);

create policy "watchlist_select_own"
  on public.research_watchlist for select
  using (auth.uid() = user_id);

create policy "watchlist_insert_own"
  on public.research_watchlist for insert
  with check (auth.uid() = user_id);

create policy "watchlist_update_own"
  on public.research_watchlist for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "watchlist_delete_own"
  on public.research_watchlist for delete
  using (auth.uid() = user_id);

comment on table public.research_watchlist is 'User maintained watchlist powering the research experience';
comment on column public.research_watchlist.ticker is 'Yahoo Finance symbol (uppercased server-side)';
comment on column public.research_watchlist.label is 'Optional nickname shown in the research UI';
