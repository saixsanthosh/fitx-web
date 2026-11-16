-- FITX Admin Phase 10: granular roles, one permission check for every privileged function, and
-- membership managed by email. Every function here is executable by service_role only.
--
-- The role-to-permission table below is mirrored in admin/src/lib/roles.ts; a test in
-- admin/tests/roles.test.mjs fails if the two drift apart.

alter table public.fitx_admin_members drop constraint if exists fitx_admin_members_role_check;
alter table public.fitx_admin_members add constraint fitx_admin_members_role_check
  check (role in ('super_admin', 'admin', 'support_agent', 'content_editor', 'viewer'));

create or replace function public.fitx_admin_role_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select case p_role
    when 'super_admin' then array['overview.view', 'reports.view', 'people.view', 'people.support', 'people.suspend', 'people.delete', 'support.view', 'support.reply', 'content.manage', 'announcements.manage', 'audit.view', 'audit.export', 'access.view', 'access.manage', 'settings.view', 'billing.view']::text[]
    when 'admin' then array['overview.view', 'reports.view', 'people.view', 'people.support', 'people.suspend', 'support.view', 'support.reply', 'content.manage', 'announcements.manage', 'audit.view', 'access.view', 'settings.view', 'billing.view']::text[]
    when 'support_agent' then array['overview.view', 'people.view', 'people.support', 'support.view', 'support.reply']::text[]
    when 'content_editor' then array['overview.view', 'content.manage', 'announcements.manage']::text[]
    when 'viewer' then array['overview.view', 'reports.view']::text[]
    else array[]::text[]
  end;
$function$;

-- True when the account is an active Admin member whose role grants the permission.
create or replace function public.fitx_admin_actor_can(p_actor_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.fitx_admin_members m
    where m.user_id = p_actor_id
      and m.is_active
      and p_permission = any (public.fitx_admin_role_permissions(m.role))
  );
$function$;

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
  perform pg_advisory_xact_lock(847281033);
  if not public.fitx_admin_actor_can(p_actor_id, 'access.manage') then
    raise exception using errcode = '42501', message = 'Active super-admin access required';
  end if;
  if p_role is null or p_role not in ('super_admin', 'admin', 'support_agent', 'content_editor', 'viewer') then
    raise exception using errcode = '22023', message = 'Invalid Admin role';
  end if;
  if p_is_active is null then
    raise exception using errcode = '22023', message = 'Membership status is required';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id and deleted_at is null) then
    raise exception using errcode = 'P0002', message = 'No FITX account with that ID';
  end if;

  select * into target from public.fitx_admin_members where user_id = p_user_id for update;
  if target.user_id is not null and target.role = 'super_admin' and target.is_active
     and (p_role <> 'super_admin' or not p_is_active)
     and (select count(*) from public.fitx_admin_members where role = 'super_admin' and is_active) <= 1 then
    raise exception using errcode = '23514', message = 'Cannot remove the last active super-admin';
  end if;

  insert into public.fitx_admin_members (user_id, role, is_active, created_by)
  values (p_user_id, p_role, p_is_active, p_actor_id)
  on conflict (user_id) do update
    set role = excluded.role, is_active = excluded.is_active, updated_at = now();

  insert into public.fitx_admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (p_actor_id, 'admin_member_updated', 'admin_member', p_user_id::text,
    jsonb_build_object(
      'before', case when target.user_id is null then null
                     else jsonb_build_object('role', target.role, 'is_active', target.is_active) end,
      'after', jsonb_build_object('role', p_role, 'is_active', p_is_active)
    ));
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
declare
  previous boolean;
begin
  if not public.fitx_admin_actor_can(p_actor_id, 'content.manage') then
    raise exception using errcode = '42501', message = 'Content permission required';
  end if;

  select is_active into previous from public.exercise_library where id = p_exercise_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Exercise not found';
  end if;
  update public.exercise_library set is_active = p_is_active where id = p_exercise_id;

  insert into public.fitx_admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (p_actor_id, 'exercise_visibility_updated', 'exercise', p_exercise_id,
    jsonb_build_object('before', jsonb_build_object('is_active', previous),
                       'after', jsonb_build_object('is_active', p_is_active)));
end;
$function$;

revoke all on function public.fitx_admin_set_exercise_active(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fitx_admin_set_exercise_active(uuid, text, boolean) to service_role;

-- Finds the FITX account for an email address (any letter case). Used to grant access by email.
create or replace function public.fitx_admin_find_user_by_email(p_email text)
returns table (user_id uuid, email text, email_confirmed_at timestamptz, last_sign_in_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $function$
  select u.id, u.email::text, u.email_confirmed_at, u.last_sign_in_at
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
    and u.deleted_at is null
  order by u.created_at
  limit 2;
$function$;

-- Admin members with their account email and last sign-in, for the Access screen.
create or replace function public.fitx_admin_list_members()
returns table (
  user_id uuid,
  email text,
  role text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  last_sign_in_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select m.user_id, u.email::text, m.role, m.is_active, m.created_at, m.updated_at, u.last_sign_in_at
  from public.fitx_admin_members m
  left join auth.users u on u.id = m.user_id
  order by m.is_active desc,
    case m.role when 'super_admin' then 0 when 'admin' then 1 when 'support_agent' then 2
                when 'content_editor' then 3 else 4 end,
    m.created_at;
$function$;

-- Email addresses for a bounded list of account IDs (audit actors, support requesters, authors).
create or replace function public.fitx_admin_user_emails(p_user_ids uuid[])
returns table (user_id uuid, email text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if coalesce(cardinality(p_user_ids), 0) > 500 then
    raise exception using errcode = '22023', message = 'At most 500 IDs per call';
  end if;
  return query
    select u.id, u.email::text
    from auth.users u
    where u.id = any (coalesce(p_user_ids, array[]::uuid[]));
end;
$function$;

revoke all on function public.fitx_admin_role_permissions(text) from public, anon, authenticated;
revoke all on function public.fitx_admin_actor_can(uuid, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_find_user_by_email(text) from public, anon, authenticated;
revoke all on function public.fitx_admin_list_members() from public, anon, authenticated;
revoke all on function public.fitx_admin_user_emails(uuid[]) from public, anon, authenticated;
grant execute on function public.fitx_admin_role_permissions(text) to service_role;
grant execute on function public.fitx_admin_actor_can(uuid, text) to service_role;
grant execute on function public.fitx_admin_find_user_by_email(text) to service_role;
grant execute on function public.fitx_admin_list_members() to service_role;
grant execute on function public.fitx_admin_user_emails(uuid[]) to service_role;
