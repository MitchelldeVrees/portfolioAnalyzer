-- Portfolio research storage
create table if not exists public.portfolio_research (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  as_of_date date,
  lookback_days int2 default 14,
  research jsonb not null,
  recommendations jsonb,
  meta jsonb
);

-- RLS
alter table public.portfolio_research enable row level security;

create policy "research_select_own"
  on public.portfolio_research for select
  using (
    exists (
      select 1 from public.portfolios
      where portfolios.id = portfolio_research.portfolio_id
      and portfolios.user_id = auth.uid()
    )
  );

create policy "research_insert_own"
  on public.portfolio_research for insert
  with check (
    exists (
      select 1 from public.portfolios
      where portfolios.id = portfolio_research.portfolio_id
      and portfolios.user_id = auth.uid()
    )
  );

create policy "research_update_own"
  on public.portfolio_research for update
  using (
    exists (
      select 1 from public.portfolios
      where portfolios.id = portfolio_research.portfolio_id
      and portfolios.user_id = auth.uid()
    )
  );

create policy "research_delete_own"
  on public.portfolio_research for delete
  using (
    exists (
      select 1 from public.portfolios
      where portfolios.id = portfolio_research.portfolio_id
      and portfolios.user_id = auth.uid()
    )
  );

-- Helpful index for recency lookup
create index if not exists idx_research_portfolio_created_desc on public.portfolio_research(portfolio_id, created_at desc);

