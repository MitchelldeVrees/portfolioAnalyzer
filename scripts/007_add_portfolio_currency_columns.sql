alter table public.portfolios
  add column if not exists base_currency text default 'USD';

alter table public.portfolio_holdings
  add column if not exists currency_code text,
  add column if not exists quote_symbol text;

create index if not exists idx_portfolios_base_currency on public.portfolios (base_currency);
create index if not exists idx_portfolio_holdings_quote_symbol on public.portfolio_holdings (quote_symbol);
