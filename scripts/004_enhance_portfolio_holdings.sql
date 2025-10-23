-- Enhance portfolio holdings table to support Bloomberg CSV export fields
-- This script adds additional columns to store comprehensive Bloomberg data

-- Add new columns to portfolio_holdings table
alter table public.portfolio_holdings 
add column if not exists security_name text,
add column if not exists isin text,
add column if not exists cusip text,
add column if not exists sedol text,
add column if not exists market_value decimal(15,2),
add column if not exists cost_value decimal(15,2),
add column if not exists unrealized_pl decimal(15,2),
add column if not exists realized_pl decimal(15,2),
add column if not exists total_pl decimal(15,2),
add column if not exists sector text,
add column if not exists country text,
add column if not exists asset_type text,
add column if not exists coupon decimal(8,4),
add column if not exists maturity_date date,
add column if not exists yield_to_maturity decimal(8,4),
add column if not exists trade_date date,
add column if not exists settlement_date date,
add column if not exists market_price decimal(15,2),
add column if not exists account_id text,
add column if not exists portfolio_name text;

-- Add indexes for commonly queried fields
create index if not exists portfolio_holdings_security_name_idx 
on public.portfolio_holdings (security_name);

create index if not exists portfolio_holdings_sector_idx 
on public.portfolio_holdings (sector);

create index if not exists portfolio_holdings_asset_type_idx 
on public.portfolio_holdings (asset_type);

create index if not exists portfolio_holdings_country_idx 
on public.portfolio_holdings (country);

-- Add comments to document the Bloomberg field mappings
comment on column public.portfolio_holdings.security_name is 'Bloomberg SECURITY_NAME field - full security description';
comment on column public.portfolio_holdings.isin is 'Bloomberg ISIN field - International Securities Identification Number';
comment on column public.portfolio_holdings.cusip is 'Bloomberg CUSIP field - Committee on Uniform Securities Identification Procedures';
comment on column public.portfolio_holdings.sedol is 'Bloomberg SEDOL1 field - Stock Exchange Daily Official List';
comment on column public.portfolio_holdings.market_value is 'Bloomberg MKT_VAL field - current market value of position';
comment on column public.portfolio_holdings.cost_value is 'Bloomberg COST_VALUE field - original cost basis of position';
comment on column public.portfolio_holdings.unrealized_pl is 'Bloomberg UNREALIZED_PL field - unrealized profit/loss';
comment on column public.portfolio_holdings.realized_pl is 'Bloomberg REALIZED_PL field - realized profit/loss';
comment on column public.portfolio_holdings.total_pl is 'Bloomberg TOTAL_PL field - total profit/loss';
comment on column public.portfolio_holdings.sector is 'Bloomberg INDUSTRY_SECTOR field - industry sector classification';
comment on column public.portfolio_holdings.country is 'Bloomberg CNTRY_OF_DOMICILE field - country of domicile';
comment on column public.portfolio_holdings.asset_type is 'Bloomberg SECURITY_TYP field - type of security (Equity, Bond, etc.)';
comment on column public.portfolio_holdings.coupon is 'Bloomberg CPN field - coupon rate for fixed income securities';
comment on column public.portfolio_holdings.maturity_date is 'Bloomberg MATURITY field - maturity date for fixed income securities';
comment on column public.portfolio_holdings.yield_to_maturity is 'Bloomberg YIELD_TO_MATURITY field - yield to maturity percentage';
comment on column public.portfolio_holdings.trade_date is 'Bloomberg TRADE_DATE field - date of trade execution';
comment on column public.portfolio_holdings.settlement_date is 'Bloomberg SETTLE_DT field - settlement date';
comment on column public.portfolio_holdings.market_price is 'Bloomberg PX_LAST field - last market price';
comment on column public.portfolio_holdings.account_id is 'Bloomberg ACCT_ID field - account identifier';
comment on column public.portfolio_holdings.portfolio_name is 'Bloomberg PORTFOLIO_NAME field - portfolio name from Bloomberg';


