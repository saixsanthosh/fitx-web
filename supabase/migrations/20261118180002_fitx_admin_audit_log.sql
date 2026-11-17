-- FITX Admin Phase 10: an append-only audit log, a logging function for Admin events that do not
-- run inside a database function (sign-ins, refusals, account actions through the Auth API, exports),
-- and indexes for the Audit screen's filters.

-- Nobody may change or remove audit rows through the API, the service key included.
revoke update, delete, truncate on table public.fitx_admin_audit_logs from public, anon, authenticated, service_role;
grant select, insert on table public.fitx_admin_audit_logs to service_role;

-- Rows keep the actor's account ID after that account is deleted. Copies of this table made before
-- that rule (the old Admin draft schema) declared actor_id with a foreign key to auth.users that
-- cleared it on deletion. 20261118180000 drops any such key; it is checked again here because, with
-- the append-only trigger below, that key would make deleting any account named in the log fail.
do $do$
declare
  fk record;
begin
  for fk in
    select conname from pg_catalog.pg_constraint
    where conrelid = 'public.fitx_admin_audit_logs'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
  loop
    execute pg_catalog.format('alter table public.fitx_admin_audit_logs drop constraint %I', fk.conname);
  end loop;
end
$do$;

-- A trigger also stops the table owner: no row is ever changed or removed.
create or replace function public.fitx_admin_audit_logs_append_only()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501', message = 'The FITX Admin audit log is append-only';
end;
$function$;

drop trigger if exists fitx_admin_audit_logs_append_only_rows on public.fitx_admin_audit_logs;
create trigger fitx_admin_audit_logs_append_only_rows
  before update or delete on public.fitx_admin_audit_logs
  for each row execute function public.fitx_admin_audit_logs_append_only();

drop trigger if exists fitx_admin_audit_logs_append_only_truncate on public.fitx_admin_audit_logs;
create trigger fitx_admin_audit_logs_append_only_truncate
  before truncate on public.fitx_admin_audit_logs
  for each statement execute function public.fitx_admin_audit_logs_append_only();

create index if not exists fitx_admin_audit_logs_action_idx
  on public.fitx_admin_audit_logs (action, created_at desc);
create index if not exists fitx_admin_audit_logs_resource_idx
  on public.fitx_admin_audit_logs (resource_type, resource_id, created_at desc);

-- Records one Admin event. Details must be a small JSON object; the app never puts message text,
-- passwords or tokens in it.
create or replace function public.fitx_admin_log_event(
  p_actor_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id text default null,
  p_details jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_id bigint;
  details jsonb := coalesce(p_details, '{}'::jsonb);
begin
  if p_action is null or p_action !~ '^[a-z][a-z0-9_]{2,79}$' then
    raise exception using errcode = '22023', message = 'Invalid audit action';
  end if;
  if p_resource_type is null or p_resource_type !~ '^[a-z][a-z0-9_]{1,79}$' then
    raise exception using errcode = '22023', message = 'Invalid audit resource type';
  end if;
  if p_resource_id is not null and char_length(p_resource_id) > 200 then
    raise exception using errcode = '22023', message = 'Audit resource ID is too long';
  end if;
  if jsonb_typeof(details) <> 'object' or octet_length(details::text) > 4000 then
    raise exception using errcode = '22023', message = 'Audit details must be a JSON object under 4 KB';
  end if;

  insert into public.fitx_admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    case when p_actor_id is not null and exists (select 1 from auth.users where id = p_actor_id)
         then p_actor_id end,
    p_action, p_resource_type, p_resource_id, details
  )
  returning id into new_id;
  return new_id;
end;
$function$;

revoke all on function public.fitx_admin_log_event(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.fitx_admin_log_event(uuid, text, text, text, jsonb) to service_role;
