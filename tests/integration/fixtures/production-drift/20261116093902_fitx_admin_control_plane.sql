-- Prepared for review only. Do not apply until the owner approves the schema change
-- and identifies the first super-admin. This migration does not seed any admin.

begin;

create table if not exists public.fitx_admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'super_admin')),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fitx_admin_members enable row level security;
alter table public.fitx_admin_members force row level security;
revoke all on table public.fitx_admin_members from public, anon, authenticated;
grant select on table public.fitx_admin_members to authenticated;

drop policy if exists fitx_admin_members_read_self on public.fitx_admin_members;
create policy fitx_admin_members_read_self
  on public.fitx_admin_members
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.fitx_admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 120),
  resource_type text not null check (char_length(resource_type) between 1 and 80),
  resource_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fitx_admin_audit_logs_created_at_idx
  on public.fitx_admin_audit_logs (created_at desc);
create index if not exists fitx_admin_audit_logs_actor_idx
  on public.fitx_admin_audit_logs (actor_id, created_at desc);

alter table public.fitx_admin_audit_logs enable row level security;
alter table public.fitx_admin_audit_logs force row level security;
revoke all on table public.fitx_admin_audit_logs from public, anon, authenticated;
grant select, insert on table public.fitx_admin_audit_logs to service_role;

create or replace function public.fitx_admin_overview_metrics()
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'registered_users', (select pg_catalog.count(*) from auth.users),
    'active_users_30d', (
      select pg_catalog.count(*)
      from auth.users
      where last_sign_in_at >= pg_catalog.now() - interval '30 days'
    ),
    'completed_workouts_30d', (
      select pg_catalog.count(*)
      from public.workout_sessions
      where status = 'completed'
        and started_at >= pg_catalog.now() - interval '30 days'
    ),
    'active_exercises', (
      select pg_catalog.count(*)
      from public.exercise_library
      where is_active = true
    ),
    'food_logs_30d', (
      select pg_catalog.count(*)
      from public.meals
      where date >= (current_date - 30)
    )
  );
$function$;

revoke all on function public.fitx_admin_overview_metrics() from public, anon, authenticated;
grant execute on function public.fitx_admin_overview_metrics() to service_role;

create or replace function public.fitx_admin_set_member(
  p_actor_id uuid,
  p_user_id uuid,
  p_role text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target public.fitx_admin_members%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(847281033);
  if not exists (
    select 1 from public.fitx_admin_members
    where user_id = p_actor_id and role = 'super_admin' and is_active
  ) then
    raise exception using errcode = '42501', message = 'Active super-admin access required';
  end if;

  if p_role is null or p_role not in ('admin', 'super_admin') then
    raise exception using errcode = '22023', message = 'Invalid Admin role';
  end if;

  select * into target from public.fitx_admin_members where user_id = p_user_id for update;
  if target.user_id is not null and target.role = 'super_admin' and target.is_active
     and (p_role <> 'super_admin' or not p_is_active)
     and (select pg_catalog.count(*) from public.fitx_admin_members where role = 'super_admin' and is_active) <= 1 then
    raise exception using errcode = '23514', message = 'Cannot remove the last active super-admin';
  end if;

  insert into public.fitx_admin_members (user_id, role, is_active, created_by)
  values (p_user_id, p_role, p_is_active, p_actor_id)
  on conflict (user_id) do update
    set role = excluded.role, is_active = excluded.is_active, updated_at = pg_catalog.now();

  insert into public.fitx_admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (p_actor_id, 'admin_member_updated', 'admin_member', p_user_id::text,
    pg_catalog.jsonb_build_object('role', p_role, 'is_active', p_is_active));
end;
$function$;

revoke all on function public.fitx_admin_set_member(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fitx_admin_set_member(uuid, uuid, text, boolean) to service_role;

create or replace function public.fitx_admin_set_exercise_active(
  p_actor_id uuid,
  p_exercise_id text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1 from public.fitx_admin_members
    where user_id = p_actor_id and role in ('admin', 'super_admin') and is_active
  ) then
    raise exception using errcode = '42501', message = 'Active Admin access required';
  end if;

  update public.exercise_library set is_active = p_is_active where id = p_exercise_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Exercise not found';
  end if;

  insert into public.fitx_admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (p_actor_id, 'exercise_visibility_updated', 'exercise', p_exercise_id,
    pg_catalog.jsonb_build_object('is_active', p_is_active));
end;
$function$;

revoke all on function public.fitx_admin_set_exercise_active(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fitx_admin_set_exercise_active(uuid, text, boolean) to service_role;

commit;

