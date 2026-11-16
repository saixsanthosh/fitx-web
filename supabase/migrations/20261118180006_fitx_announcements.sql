-- FITX Phase 10: announcements written in Admin and shown to signed-in customers.
--
-- Customers read published announcements inside their time window and record their own dismissals.
-- Admin writes through audited functions. The only reach figure Admin shows is the real number of
-- accounts that dismissed an announcement; nothing tracks views.

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 1 and 600),
  tone text not null default 'info' check (tone in ('info', 'success', 'warning')),
  link_url text check (
    link_url is null
    or (char_length(link_url) <= 300 and (link_url ~ '^/([^/\\]|$)' or link_url ~ '^https://[^\s]+$'))
  ),
  link_label text check (link_label is null or char_length(link_label) between 1 and 40),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_window_check check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint announcements_link_pair_check check ((link_url is null) = (link_label is null))
);

create index if not exists announcements_live_idx on public.announcements (status, published_at desc);
create index if not exists announcements_created_by_idx on public.announcements (created_by);
create index if not exists announcements_updated_by_idx on public.announcements (updated_by);

create table if not exists public.announcement_dismissals (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create index if not exists announcement_dismissals_user_idx on public.announcement_dismissals (user_id);

alter table public.announcements enable row level security;
alter table public.announcement_dismissals enable row level security;

revoke all on table public.announcements from public, anon, authenticated, service_role;
revoke all on table public.announcement_dismissals from public, anon, authenticated, service_role;
grant select (id, title, body, tone, link_url, link_label, status, starts_at, ends_at, published_at)
  on table public.announcements to authenticated;
grant select on table public.announcements to service_role;
grant select, insert, delete on table public.announcement_dismissals to authenticated;
grant select on table public.announcement_dismissals to service_role;

drop policy if exists announcements_read_live on public.announcements;
create policy announcements_read_live
  on public.announcements
  for select
  to authenticated
  using (
    status = 'published'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );

drop policy if exists announcement_dismissals_own on public.announcement_dismissals;
create policy announcement_dismissals_own
  on public.announcement_dismissals
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Admin: create (p_id null) or edit an announcement. A new announcement starts as a draft; editing
-- keeps its status. A published announcement changes for signed-in people as soon as it is saved, so
-- editing one needs p_confirm_live (55000 otherwise). The audit row records every field before and
-- after; the message only as its length and a fingerprint, so a changed text is visible without
-- copying it into the log.
drop function if exists public.fitx_admin_save_announcement(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz);
create or replace function public.fitx_admin_save_announcement(
  p_actor_id uuid,
  p_id uuid,
  p_title text,
  p_body text,
  p_tone text,
  p_link_url text,
  p_link_label text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_confirm_live boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous public.announcements%rowtype;
  saved public.announcements%rowtype;
  hidden_fields constant text[] := array['id', 'body', 'created_by', 'updated_by', 'created_at', 'updated_at'];
begin
  if not public.fitx_admin_actor_can(p_actor_id, 'announcements.manage') then
    raise exception using errcode = '42501', message = 'Announcement permission required';
  end if;

  if p_id is null then
    insert into public.announcements (title, body, tone, link_url, link_label, starts_at, ends_at, created_by, updated_by)
    values (btrim(p_title), btrim(p_body), coalesce(p_tone, 'info'), nullif(btrim(coalesce(p_link_url, '')), ''),
            nullif(btrim(coalesce(p_link_label, '')), ''), p_starts_at, p_ends_at, p_actor_id, p_actor_id)
    returning * into saved;
    insert into public.fitx_admin_audit_logs (actor_id, action, resource_type, resource_id, details)
    values (p_actor_id, 'announcement_created', 'announcement', saved.id::text,
      jsonb_build_object('after', (to_jsonb(saved) - hidden_fields)
        || jsonb_build_object('body_characters', char_length(saved.body), 'body_fingerprint', left(md5(saved.body), 12))));
    return saved.id;
  end if;

  select * into previous from public.announcements where id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Announcement not found';
  end if;
  if previous.status = 'published' and not coalesce(p_confirm_live, false) then
    raise exception using errcode = '55000', message = 'Saving a published announcement needs confirmation';
  end if;
  update public.announcements
  set title = btrim(p_title),
      body = btrim(p_body),
      tone = coalesce(p_tone, 'info'),
      link_url = nullif(btrim(coalesce(p_link_url, '')), ''),
      link_label = nullif(btrim(coalesce(p_link_label, '')), ''),
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      updated_by = p_actor_id,
      updated_at = now()
  where id = p_id
  returning * into saved;
  insert into public.fitx_admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (p_actor_id, 'announcement_updated', 'announcement', p_id::text,
    jsonb_build_object(
      'before', (to_jsonb(previous) - hidden_fields)
        || jsonb_build_object('body_characters', char_length(previous.body), 'body_fingerprint', left(md5(previous.body), 12)),
      'after', (to_jsonb(saved) - hidden_fields)
        || jsonb_build_object('body_characters', char_length(saved.body), 'body_fingerprint', left(md5(saved.body), 12))
    ));
  return p_id;
end;
$function$;

-- Admin: publish, return to draft, or archive.
create or replace function public.fitx_admin_set_announcement_status(p_actor_id uuid, p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous_status text;
begin
  if not public.fitx_admin_actor_can(p_actor_id, 'announcements.manage') then
    raise exception using errcode = '42501', message = 'Announcement permission required';
  end if;
  if p_status is null or p_status not in ('draft', 'published', 'archived') then
    raise exception using errcode = '22023', message = 'Invalid announcement status';
  end if;
  select status into previous_status from public.announcements where id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Announcement not found';
  end if;

  update public.announcements
  set status = p_status,
      published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
      updated_by = p_actor_id,
      updated_at = now()
  where id = p_id;

  insert into public.fitx_admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (p_actor_id,
    case p_status when 'published' then 'announcement_published'
                  when 'archived' then 'announcement_archived'
                  else 'announcement_unpublished' end,
    'announcement', p_id::text,
    jsonb_build_object('before', jsonb_build_object('status', previous_status),
                       'after', jsonb_build_object('status', p_status)));
end;
$function$;

-- Admin: how many accounts dismissed each announcement.
create or replace function public.fitx_admin_announcement_dismissals(p_ids uuid[])
returns table (announcement_id uuid, dismissals bigint)
language sql
stable
security definer
set search_path = ''
as $function$
  select d.announcement_id, count(*)
  from public.announcement_dismissals d
  where d.announcement_id = any (coalesce(p_ids, array[]::uuid[]))
  group by d.announcement_id;
$function$;

revoke all on function public.fitx_admin_save_announcement(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.fitx_admin_set_announcement_status(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_announcement_dismissals(uuid[]) from public, anon, authenticated;
grant execute on function public.fitx_admin_save_announcement(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, boolean) to service_role;
grant execute on function public.fitx_admin_set_announcement_status(uuid, uuid, text) to service_role;
grant execute on function public.fitx_admin_announcement_dismissals(uuid[]) to service_role;
