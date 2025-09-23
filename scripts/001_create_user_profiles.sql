-- Create user profiles table for portfolio analysis app
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.profiles enable row level security;

-- Create policies for profiles
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

create policy "profiles_delete_own"
  on public.profiles for delete
  using (auth.uid() = id);

-- Create portfolios table
create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS for portfolios
alter table public.portfolios enable row level security;

-- Create policies for portfolios
create policy "portfolios_select_own"
  on public.portfolios for select
  using (auth.uid() = user_id);

create policy "portfolios_insert_own"
  on public.portfolios for insert
  with check (auth.uid() = user_id);

create policy "portfolios_update_own"
  on public.portfolios for update
  using (auth.uid() = user_id);

create policy "portfolios_delete_own"
  on public.portfolios for delete
  using (auth.uid() = user_id);

-- Create portfolio holdings table
create table if not exists public.portfolio_holdings (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  ticker text not null,
  weight decimal(5,4) not null check (weight >= 0 and weight <= 1),
  shares decimal(15,6),
  purchase_price decimal(15,2),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS for portfolio holdings
alter table public.portfolio_holdings enable row level security;

-- Create policies for portfolio holdings (access through portfolio ownership)
create policy "holdings_select_own"
  on public.portfolio_holdings for select
  using (
    exists (
      select 1 from public.portfolios 
      where portfolios.id = portfolio_holdings.portfolio_id 
      and portfolios.user_id = auth.uid()
    )
  );

create policy "holdings_insert_own"
  on public.portfolio_holdings for insert
  with check (
    exists (
      select 1 from public.portfolios 
      where portfolios.id = portfolio_holdings.portfolio_id 
      and portfolios.user_id = auth.uid()
    )
  );

create policy "holdings_update_own"
  on public.portfolio_holdings for update
  using (
    exists (
      select 1 from public.portfolios 
      where portfolios.id = portfolio_holdings.portfolio_id 
      and portfolios.user_id = auth.uid()
    )
  );

create policy "holdings_delete_own"
  on public.portfolio_holdings for delete
  using (
    exists (
      select 1 from public.portfolios 
      where portfolios.id = portfolio_holdings.portfolio_id 
      and portfolios.user_id = auth.uid()
    )
  );

-- Create function to auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Create trigger for auto-profile creation
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
