-- FITX Phase 10: Help requests from the customer app and the Admin support queue.
--
-- Customers create requests and replies only through the rate-limited functions below, and read only
-- their own threads. Column grants keep staff account IDs, assignees and priorities out of their
-- reach. Admin reads with the service key and writes through audited functions.

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category in ('question', 'problem', 'feedback', 'account', 'other')),
  subject text not null check (char_length(subject) between 3 and 120),
  body text not null check (char_length(body) between 10 and 4000),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid references auth.users (id) on delete set null,
  page_path text check (page_path is null or char_length(page_path) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists support_requests_user_idx on public.support_requests (user_id, created_at desc);
create index if not exists support_requests_queue_idx on public.support_requests (status, last_message_at desc);
create index if not exists support_requests_assignee_idx on public.support_requests (assigned_to);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.support_requests (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  author_kind text not null check (author_kind in ('user', 'staff')),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists support_messages_request_idx on public.support_messages (request_id, created_at);
create index if not exists support_messages_author_idx on public.support_messages (author_id);

alter table public.support_requests enable row level security;
alter table public.support_messages enable row level security;

revoke all on table public.support_requests from public, anon, authenticated, service_role;
revoke all on table public.support_messages from public, anon, authenticated, service_role;
grant select (id, user_id, category, subject, body, status, created_at, updated_at, last_message_at)
  on table public.support_requests to authenticated;
grant select (id, request_id, author_kind, body, created_at) on table public.support_messages to authenticated;
grant select on table public.support_requests, public.support_messages to service_role;

drop policy if exists support_requests_read_own on public.support_requests;
create policy support_requests_read_own
  on public.support_requests
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists support_messages_read_own on public.support_messages;
create policy support_messages_read_own
  on public.support_messages
  for select
  to authenticated
  using (exists (
    select 1 from public.support_requests r
    where r.id = support_messages.request_id and r.user_id = (select auth.uid())
  ));

-- Customer: open a request. At most 3 an hour and 10 a day per account (HTTP 429 through PostgREST).
create or replace function public.fitx_submit_support_request(
  p_category text,
  p_subject text,
  p_body text,
  p_page_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  uid uuid := auth.uid();
  last_hour integer;
  last_day integer;
  new_id uuid;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  -- One account's requests are counted one at a time, so parallel submissions cannot pass the limit.
  perform pg_advisory_xact_lock(hashtextextended('fitx_support:' || uid::text, 0));
  select count(*) filter (where created_at > now() - interval '1 hour'), count(*)
    into last_hour, last_day
  from public.support_requests
  where user_id = uid and created_at > now() - interval '1 day';
  if last_hour >= 3 or last_day >= 10 then
    raise exception using errcode = 'PT429', message = 'support_rate_limited',
      detail = case when last_hour >= 3 then 'hour' else 'day' end;
  end if;

  insert into public.support_requests (user_id, category, subject, body, page_path)
  values (uid, p_category, btrim(p_subject), btrim(p_body), nullif(btrim(coalesce(p_page_path, '')), ''))
  returning id into new_id;
  return new_id;
end;
$function$;

-- Customer: reply on one of their own requests. At most 10 replies an hour per account.
create or replace function public.fitx_reply_support_request(p_request_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  uid uuid := auth.uid();
  current_status text;
  last_hour integer;
  new_id uuid;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  -- Same per-account lock as new requests, taken before the row lock, so parallel replies are
  -- counted one at a time and cannot pass the hourly limit.
  perform pg_advisory_xact_lock(hashtextextended('fitx_support:' || uid::text, 0));
  select status into current_status
  from public.support_requests
  where id = p_request_id and user_id = uid
  for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'support_request_not_found';
  end if;
  if current_status = 'closed' then
    raise exception using errcode = 'PT409', message = 'support_request_closed';
  end if;
  select count(*) into last_hour
  from public.support_messages m
  join public.support_requests r on r.id = m.request_id
  where r.user_id = uid and m.author_kind = 'user' and m.created_at > now() - interval '1 hour';
  if last_hour >= 10 then
    raise exception using errcode = 'PT429', message = 'support_rate_limited', detail = 'hour';
  end if;

  insert into public.support_messages (request_id, author_id, author_kind, body)
  values (p_request_id, uid, 'user', btrim(p_body))
  returning id into new_id;
  update public.support_requests
  set last_message_at = now(),
      updated_at = now(),
      status = case when status in ('waiting_on_user', 'resolved') then 'open' else status end
  where id = p_request_id;
  return new_id;
end;
$function$;

revoke all on function public.fitx_submit_support_request(text, text, text, text) from public, anon;
revoke all on function public.fitx_reply_support_request(uuid, text) from public, anon;
grant execute on function public.fitx_submit_support_request(text, text, text, text) to authenticated;
grant execute on function public.fitx_reply_support_request(uuid, text) to authenticated;

-- Admin: change status, priority or assignee. The assignee must be an active member who can see support.
create or replace function public.fitx_admin_support_update(
  p_actor_id uuid,
  p_request_id uuid,
  p_status text,
  p_priority text,
  p_assigned_to uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous public.support_requests%rowtype;
begin
  if not public.fitx_admin_actor_can(p_actor_id, 'support.reply') then
    raise exception using errcode = '42501', message = 'Support permission required';
  end if;
  if p_status is null or p_status not in ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed') then
    raise exception using errcode = '22023', message = 'Invalid status';
  end if;
  if p_priority is null or p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception using errcode = '22023', message = 'Invalid priority';
  end if;
  if p_assigned_to is not null and not public.fitx_admin_actor_can(p_assigned_to, 'support.view') then
    raise exception using errcode = '22023', message = 'The assignee must be an active Admin member with support access';
  end if;

  select * into previous from public.support_requests where id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Support request not found';
  end if;

  update public.support_requests
  set status = p_status, priority = p_priority, assigned_to = p_assigned_to, updated_at = now()
  where id = p_request_id;

  insert into public.fitx_admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (p_actor_id, 'support_request_updated', 'support_request', p_request_id::text,
    jsonb_build_object(
      'before', jsonb_build_object('status', previous.status, 'priority', previous.priority, 'assigned_to', previous.assigned_to),
      'after', jsonb_build_object('status', p_status, 'priority', p_priority, 'assigned_to', p_assigned_to)
    ));
end;
$function$;

-- Admin: reply as FITX Support and set the status in the same step. The audit row records the
-- reply's length, never its text.
create or replace function public.fitx_admin_support_reply(
  p_actor_id uuid,
  p_request_id uuid,
  p_body text,
  p_status text default 'waiting_on_user'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous_status text;
  reply text := btrim(coalesce(p_body, ''));
  new_id uuid;
begin
  if not public.fitx_admin_actor_can(p_actor_id, 'support.reply') then
    raise exception using errcode = '42501', message = 'Support permission required';
  end if;
  if p_status is null or p_status not in ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed') then
    raise exception using errcode = '22023', message = 'Invalid status';
  end if;
  select status into previous_status from public.support_requests where id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Support request not found';
  end if;

  insert into public.support_messages (request_id, author_id, author_kind, body)
  values (p_request_id, p_actor_id, 'staff', reply)
  returning id into new_id;
  update public.support_requests
  set status = p_status, last_message_at = now(), updated_at = now()
  where id = p_request_id;

  insert into public.fitx_admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (p_actor_id, 'support_reply_sent', 'support_request', p_request_id::text,
    jsonb_build_object('characters', char_length(reply), 'before', jsonb_build_object('status', previous_status),
                       'after', jsonb_build_object('status', p_status)));
  return new_id;
end;
$function$;

-- Admin: number of requests in each status, for the queue tabs and the Overview.
create or replace function public.fitx_admin_support_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
  from (select status, count(*) as n from public.support_requests group by status) counts;
$function$;

revoke all on function public.fitx_admin_support_update(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.fitx_admin_support_reply(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_support_counts() from public, anon, authenticated;
grant execute on function public.fitx_admin_support_update(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.fitx_admin_support_reply(uuid, uuid, text, text) to service_role;
grant execute on function public.fitx_admin_support_counts() to service_role;
