-- Catalog of Yahoo Finance tickers mirrored locally for fast lookups.
create table if not exists public.yahoo_tickers (
  symbol text primary key,
  name text not null,
  exchange text,
  instrument_type text,
  is_etf boolean default false,
  market_cap numeric,
  currency text,
  source text,
  metadata jsonb,
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists yahoo_tickers_symbol_idx on public.yahoo_tickers (symbol);
create index if not exists yahoo_tickers_name_idx on public.yahoo_tickers (lower(name));

alter table public.yahoo_tickers enable row level security;

create policy "yahoo_tickers_public_read"
  on public.yahoo_tickers
  for select
  using (true);

create policy "yahoo_tickers_service_role_write"
  on public.yahoo_tickers
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
