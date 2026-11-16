-- Per-account food search limit (30 a minute, 500 a day) so one account cannot exhaust the shared
-- Open Food Facts and USDA quotas. The table has RLS on, no policies and no grants: only the
-- security definer function below reads or writes it, always for auth.uid().
create table if not exists public.fitx_rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null check (bucket in ('food_search_minute', 'food_search_day')),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (user_id, bucket, window_start)
);
alter table public.fitx_rate_limits enable row level security;
revoke all on table public.fitx_rate_limits from public, anon, authenticated;

create or replace function public.fitx_take_food_search_quota()
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  minute_start timestamptz := date_trunc('minute', now());
  day_start timestamptz := date_trunc('day', now());
  minute_hits integer;
  day_hits integer;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  insert into public.fitx_rate_limits as r (user_id, bucket, window_start, hits)
  values (uid, 'food_search_minute', minute_start, 1)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + 1
  returning r.hits into minute_hits;
  insert into public.fitx_rate_limits as r (user_id, bucket, window_start, hits)
  values (uid, 'food_search_day', day_start, 1)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + 1
  returning r.hits into day_hits;
  delete from public.fitx_rate_limits where user_id = uid and window_start < now() - interval '2 days';
  if minute_hits > 30 then
    return query select false, greatest(1, ceil(extract(epoch from (minute_start + interval '1 minute' - now())))::integer);
  elsif day_hits > 500 then
    return query select false, greatest(1, ceil(extract(epoch from (day_start + interval '1 day' - now())))::integer);
  else
    return query select true, 0;
  end if;
end $$;

revoke all on function public.fitx_take_food_search_quota() from public, anon;
grant execute on function public.fitx_take_food_search_quota() to authenticated;
