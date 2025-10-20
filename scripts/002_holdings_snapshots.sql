-- Cache computed holdings analytics per portfolio and benchmark
create table if not exists public.portfolio_holdings_snapshots (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  benchmark text not null,
  payload jsonb not null,
  refreshed_at timestamp with time zone not null default timezone('utc'::text, now()),
  refreshed_by uuid references auth.users(id),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint portfolio_holdings_snapshots_unique unique (portfolio_id, benchmark)
);

create index if not exists portfolio_holdings_snapshots_portfolio_idx
  on public.portfolio_holdings_snapshots (portfolio_id, refreshed_at desc);

alter table public.portfolio_holdings_snapshots enable row level security;

create policy "holdings_snapshots_select_own"
  on public.portfolio_holdings_snapshots for select
  using (
    exists (
      select 1 from public.portfolios
      where portfolios.id = portfolio_holdings_snapshots.portfolio_id
        and portfolios.user_id = auth.uid()
    )
  );

create policy "holdings_snapshots_insert_own"
  on public.portfolio_holdings_snapshots for insert
  with check (
    exists (
      select 1 from public.portfolios
      where portfolios.id = portfolio_holdings_snapshots.portfolio_id
        and portfolios.user_id = auth.uid()
    )
  );

create policy "holdings_snapshots_update_own"
  on public.portfolio_holdings_snapshots for update
  using (
    exists (
      select 1 from public.portfolios
      where portfolios.id = portfolio_holdings_snapshots.portfolio_id
        and portfolios.user_id = auth.uid()
    )
  );

create policy "holdings_snapshots_delete_own"
  on public.portfolio_holdings_snapshots for delete
  using (
    exists (
      select 1 from public.portfolios
      where portfolios.id = portfolio_holdings_snapshots.portfolio_id
        and portfolios.user_id = auth.uid()
    )
  );
