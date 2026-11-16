-- FITX Admin Phase 10: People search and session revocation. Account details only: these functions
-- read Auth account fields and never touch profiles, workouts, meals or other health data.
-- Suspension, password-reset emails and deletion go through the Supabase Auth Admin API from the
-- Admin server, which writes its own audit rows with fitx_admin_log_event.

-- Searches accounts by part of the email address or by exact account ID, newest first.
create or replace function public.fitx_admin_search_users(
  p_query text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  providers text[],
  admin_role text,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  with params as (
    select nullif(btrim(coalesce(p_query, '')), '') as q,
           least(greatest(coalesce(p_limit, 25), 1), 100) as lim,
           least(greatest(coalesce(p_offset, 0), 0), 100000) as off
  ),
  matched as (
    select u.*
    from auth.users u, params p
    where u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (
        p.q is null
        or u.email ilike '%' || replace(replace(replace(p.q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        or u.id::text = lower(p.q)
      )
  )
  select m.id,
         m.email::text,
         m.created_at,
         m.last_sign_in_at,
         m.email_confirmed_at,
         m.banned_until,
         case when jsonb_typeof(m.raw_app_meta_data -> 'providers') = 'array'
              then array(select jsonb_array_elements_text(m.raw_app_meta_data -> 'providers'))
              else array[]::text[] end,
         (select am.role from public.fitx_admin_members am where am.user_id = m.id),
         count(*) over ()
  from matched m
  order by m.created_at desc
  limit (select lim from params)
  offset (select off from params);
$function$;

-- Ends every sign-in session of an account (all devices). Access tokens that were already issued
-- stay valid until they expire, at most one hour later; refreshing them fails.
create or replace function public.fitx_admin_revoke_user_sessions(
  p_actor_id uuid,
  p_user_id uuid,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  revoked integer;
begin
  if not public.fitx_admin_actor_can(p_actor_id, 'people.support') then
    raise exception using errcode = '42501', message = 'People support permission required';
  end if;
  if p_actor_id = p_user_id then
    raise exception using errcode = '22023', message = 'Use Sign out to end your own session';
  end if;
  if exists (select 1 from public.fitx_admin_members where user_id = p_user_id)
     and not public.fitx_admin_actor_can(p_actor_id, 'access.manage') then
    raise exception using errcode = '42501', message = 'Only a super-admin can act on Admin team accounts';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = 'P0002', message = 'Account not found';
  end if;

  delete from auth.sessions where user_id = p_user_id;
  get diagnostics revoked = row_count;

  insert into public.fitx_admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (p_actor_id, 'user_sessions_revoked', 'user', p_user_id::text,
    jsonb_build_object('sessions_revoked', revoked, 'reason', left(btrim(coalesce(p_reason, '')), 200)));
  return revoked;
end;
$function$;

revoke all on function public.fitx_admin_search_users(text, integer, integer) from public, anon, authenticated;
revoke all on function public.fitx_admin_revoke_user_sessions(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fitx_admin_search_users(text, integer, integer) to service_role;
grant execute on function public.fitx_admin_revoke_user_sessions(uuid, uuid, text) to service_role;
