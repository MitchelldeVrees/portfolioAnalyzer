-- Add SnapTrade integration columns to user profiles
alter table public.profiles
  add column if not exists snaptrade_user_id text,
  add column if not exists snaptrade_user_secret text,
  add column if not exists snaptrade_last_sync timestamptz;

create index if not exists idx_profiles_snaptrade_user_id on public.profiles (snaptrade_user_id) where snaptrade_user_id is not null;
