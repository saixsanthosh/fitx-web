-- A stand-in for what a Supabase project already has before any FITX migration runs, for throwaway
-- local PostgreSQL clusters in tests (tests/support/local-postgres.mjs). Never apply it to a real database.
--
-- It is a superset of what supabase/migrations uses, with Supabase's own names, types, owners and grants:
--   * the API roles anon, authenticated and service_role, plus authenticator, dashboard_user and the
--     supabase_auth_admin / supabase_storage_admin roles that own the auth and storage objects;
--   * public's default privileges: new tables, functions and sequences are granted to anon, authenticated
--     and service_role unless a migration revokes them;
--   * the extensions schema (uuid-ossp and pgcrypto installed in it, as on every project) on postgres's
--     search path, so `create extension ... with schema extensions` and unqualified extension functions
--     behave as they do on Supabase;
--   * auth as Supabase Auth (GoTrue) leaves it: users, identities, sessions, refresh_tokens, mfa_factors,
--     mfa_challenges, mfa_amr_claims, one_time_tokens, audit_log_entries and instances with their real
--     columns, types, keys, cascades and indexes, row level security on, and auth.uid(), auth.role(),
--     auth.email() and auth.jwt() reading the JWT claims PostgREST sets (request.jwt.claims, or the older
--     request.jwt.claim.<name> settings);
--   * storage as Supabase Storage leaves it: buckets and objects (row level security on, granted to the API
--     roles) and the helpers policies use: foldername(), filename(), extension(), plus get_size_by_bucket(),
--     operation() and the two triggers Storage keeps on its tables;
--   * the supabase_realtime publication (empty, as on a new project);
--   * public.rls_auto_enable(), the event-trigger function the FITX project has outside any migration
--     (20260924164105 changes its privileges).
--
-- Differences from a hosted project, on purpose:
--   * Everything runs as the cluster's superuser, named postgres. On Supabase postgres is not a superuser
--     but has BYPASSRLS and owns what migrations create, so row level security behaves the same here:
--     the API roles get policies, postgres and service_role bypass them.
--   * rls_auto_enable()'s event trigger is not installed. On the hosted project it switches row level
--     security on for every new public table; leaving it out lets tests prove the migrations do that
--     themselves, so a fresh project without the trigger is just as safe.
--   * Extensions Supabase provides but a plain PostgreSQL lacks (pg_cron, pg_net, pg_graphql, vault) are
--     not here. Tests skip a migration that needs one and say so.

-- Roles ------------------------------------------------------------------------------------------------
-- As Supabase creates them. Nothing logs in as them here, so they are all NOLOGIN.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator nologin noinherit;
create role dashboard_user nologin createdb createrole replication;
create role supabase_auth_admin nologin noinherit createrole;
create role supabase_storage_admin nologin noinherit createrole;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;
grant supabase_auth_admin, supabase_storage_admin to postgres;

-- public -----------------------------------------------------------------------------------------------
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

-- extensions -------------------------------------------------------------------------------------------
create schema extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;
grant all on schema extensions to dashboard_user;
-- Supabase sets this on the postgres role, which migrations run as (new connections pick it up).
alter role postgres set search_path = "$user", public, extensions;
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'uuid-ossp') then
    create extension if not exists "uuid-ossp" with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pgcrypto') then
    create extension if not exists pgcrypto with schema extensions;
  end if;
end $$;

-- auth -------------------------------------------------------------------------------------------------
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
grant all on schema auth to supabase_auth_admin, dashboard_user;
grant usage on schema auth to postgres;

-- Supabase Auth owns its tables, types and functions.
set role supabase_auth_admin;

create type auth.aal_level as enum ('aal1', 'aal2', 'aal3');
create type auth.factor_type as enum ('totp', 'webauthn', 'phone');
create type auth.factor_status as enum ('unverified', 'verified');
create type auth.one_time_token_type as enum (
  'confirmation_token', 'reauthentication_token', 'recovery_token',
  'email_change_token_new', 'email_change_token_current', 'phone_change_token'
);

create table auth.instances (
  id uuid not null primary key,
  uuid uuid,
  raw_base_config text,
  created_at timestamptz,
  updated_at timestamptz
);
comment on table auth.instances is 'Auth: Manages users across multiple sites.';

-- No defaults on id, created_at or the metadata columns: Supabase Auth fills them in when it signs a user up.
create table auth.users (
  instance_id uuid,
  id uuid not null,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  email_change_token_new varchar(255),
  email_change varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz,
  updated_at timestamptz,
  phone text default null::character varying,
  phone_confirmed_at timestamptz,
  phone_change text default ''::character varying,
  phone_change_token varchar(255) default ''::character varying,
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  email_change_token_current varchar(255) default ''::character varying,
  email_change_confirm_status smallint default 0,
  banned_until timestamptz,
  reauthentication_token varchar(255) default ''::character varying,
  reauthentication_sent_at timestamptz,
  is_sso_user boolean not null default false,
  deleted_at timestamptz,
  is_anonymous boolean not null default false,
  constraint users_pkey primary key (id),
  constraint users_phone_key unique (phone),
  constraint users_email_change_confirm_status_check check (email_change_confirm_status >= 0 and email_change_confirm_status <= 2)
);
comment on table auth.users is 'Auth: Stores user login data within a secure schema.';
comment on column auth.users.is_sso_user is 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';
create unique index confirmation_token_idx on auth.users (confirmation_token) where confirmation_token::text !~ '^[0-9 ]*$';
create unique index email_change_token_current_idx on auth.users (email_change_token_current) where email_change_token_current::text !~ '^[0-9 ]*$';
create unique index email_change_token_new_idx on auth.users (email_change_token_new) where email_change_token_new::text !~ '^[0-9 ]*$';
create unique index reauthentication_token_idx on auth.users (reauthentication_token) where reauthentication_token::text !~ '^[0-9 ]*$';
create unique index recovery_token_idx on auth.users (recovery_token) where recovery_token::text !~ '^[0-9 ]*$';
create unique index users_email_partial_key on auth.users (email) where is_sso_user = false;
comment on index auth.users_email_partial_key is 'Auth: A partial unique index that applies only when is_sso_user is false';
create index users_instance_id_email_idx on auth.users (instance_id, lower(email::text));
create index users_instance_id_idx on auth.users (instance_id);
create index users_is_anonymous_idx on auth.users (is_anonymous);

create table auth.identities (
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  email text generated always as (lower(identity_data ->> 'email')) stored,
  id uuid not null default gen_random_uuid(),
  constraint identities_pkey primary key (id),
  constraint identities_provider_id_provider_unique unique (provider_id, provider)
);
comment on table auth.identities is 'Auth: Stores identities associated to a user.';
comment on column auth.identities.email is 'Auth: Email is a generated column that references the optional email property in the identity_data';
create index identities_email_idx on auth.identities (email text_pattern_ops);
create index identities_user_id_idx on auth.identities (user_id);

create table auth.sessions (
  id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz,
  updated_at timestamptz,
  factor_id uuid,
  aal auth.aal_level,
  not_after timestamptz,
  refreshed_at timestamp,
  user_agent text,
  ip inet,
  tag text,
  constraint sessions_pkey primary key (id)
);
comment on table auth.sessions is 'Auth: Stores session data associated to a user.';
comment on column auth.sessions.not_after is 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';
create index sessions_not_after_idx on auth.sessions (not_after desc);
create index sessions_user_id_idx on auth.sessions (user_id);
create index user_id_created_at_idx on auth.sessions (user_id, created_at);

-- Signing a session out removes its refresh tokens and MFA claims with it (on delete cascade).
create table auth.refresh_tokens (
  instance_id uuid,
  id bigserial not null,
  token varchar(255),
  user_id varchar(255),
  revoked boolean,
  created_at timestamptz,
  updated_at timestamptz,
  parent varchar(255),
  session_id uuid references auth.sessions (id) on delete cascade,
  constraint refresh_tokens_pkey primary key (id),
  constraint refresh_tokens_token_unique unique (token)
);
comment on table auth.refresh_tokens is 'Auth: Store of tokens used to refresh JWT tokens once they expire.';
create index refresh_tokens_instance_id_idx on auth.refresh_tokens (instance_id);
create index refresh_tokens_instance_id_user_id_idx on auth.refresh_tokens (instance_id, user_id);
create index refresh_tokens_parent_idx on auth.refresh_tokens (parent);
create index refresh_tokens_session_id_revoked_idx on auth.refresh_tokens (session_id, revoked);
create index refresh_tokens_updated_at_idx on auth.refresh_tokens (updated_at desc);

create table auth.mfa_factors (
  id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type auth.factor_type not null,
  status auth.factor_status not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  secret text,
  phone text,
  last_challenged_at timestamptz,
  web_authn_credential jsonb,
  web_authn_aaguid uuid,
  constraint mfa_factors_pkey primary key (id),
  constraint mfa_factors_last_challenged_at_key unique (last_challenged_at)
);
comment on table auth.mfa_factors is 'auth: stores metadata about factors';
create index factor_id_created_at_idx on auth.mfa_factors (user_id, created_at);
create unique index mfa_factors_user_friendly_name_unique on auth.mfa_factors (friendly_name, user_id) where trim(friendly_name) <> '';
create index mfa_factors_user_id_idx on auth.mfa_factors (user_id);
create unique index unique_phone_factor_per_user on auth.mfa_factors (user_id, phone);

create table auth.mfa_challenges (
  id uuid not null,
  factor_id uuid not null,
  created_at timestamptz not null,
  verified_at timestamptz,
  ip_address inet not null,
  otp_code text,
  web_authn_session_data jsonb,
  constraint mfa_challenges_pkey primary key (id),
  constraint mfa_challenges_auth_factor_id_fkey foreign key (factor_id) references auth.mfa_factors (id) on delete cascade
);
comment on table auth.mfa_challenges is 'auth: stores metadata about challenge requests made';
create index mfa_challenge_created_at_idx on auth.mfa_challenges (created_at desc);

create table auth.mfa_amr_claims (
  session_id uuid not null references auth.sessions (id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  authentication_method text not null,
  id uuid not null,
  constraint amr_id_pk primary key (id),
  constraint mfa_amr_claims_session_id_authentication_method_pkey unique (session_id, authentication_method)
);
comment on table auth.mfa_amr_claims is 'auth: stores authenticator method reference claims for multi factor authentication';

create table auth.one_time_tokens (
  id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_type auth.one_time_token_type not null,
  token_hash text not null,
  relates_to text not null,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  constraint one_time_tokens_pkey primary key (id),
  constraint one_time_tokens_token_hash_check check (char_length(token_hash) > 0)
);
create index one_time_tokens_relates_to_hash_idx on auth.one_time_tokens using hash (relates_to);
create index one_time_tokens_token_hash_hash_idx on auth.one_time_tokens using hash (token_hash);
create unique index one_time_tokens_user_id_token_type_key on auth.one_time_tokens (user_id, token_type);

create table auth.audit_log_entries (
  instance_id uuid,
  id uuid not null,
  payload json,
  created_at timestamptz,
  ip_address varchar(64) not null default ''::character varying,
  constraint audit_log_entries_pkey primary key (id)
);
comment on table auth.audit_log_entries is 'Auth: Audit trail for user actions.';
create index audit_logs_instance_id_idx on auth.audit_log_entries (instance_id);

-- Row level security is on for every auth table, with no policies: the API roles read none of it.
alter table auth.instances enable row level security;
alter table auth.users enable row level security;
alter table auth.identities enable row level security;
alter table auth.sessions enable row level security;
alter table auth.refresh_tokens enable row level security;
alter table auth.mfa_factors enable row level security;
alter table auth.mfa_challenges enable row level security;
alter table auth.mfa_amr_claims enable row level security;
alter table auth.one_time_tokens enable row level security;
alter table auth.audit_log_entries enable row level security;

-- The JWT helpers, as Supabase Auth defines them.
create function auth.uid() returns uuid
language sql stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
comment on function auth.uid() is 'Deprecated. Use auth.jwt() -> ''sub'' instead.';

create function auth.role() returns text
language sql stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
comment on function auth.role() is 'Deprecated. Use auth.jwt() -> ''role'' instead.';

create function auth.email() returns text
language sql stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;
comment on function auth.email() is 'Deprecated. Use auth.jwt() -> ''email'' instead.';

create function auth.jwt() returns jsonb
language sql stable
as $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;

reset role;

grant all on all tables in schema auth to postgres, dashboard_user;
grant all on all sequences in schema auth to postgres, dashboard_user;
grant all on all routines in schema auth to postgres, dashboard_user;
grant execute on function auth.uid(), auth.role(), auth.email(), auth.jwt() to public;

-- storage ----------------------------------------------------------------------------------------------
create schema storage;
grant usage on schema storage to postgres, anon, authenticated, service_role;
grant all on schema storage to supabase_storage_admin, dashboard_user;

-- Supabase Storage owns its tables and functions.
set role supabase_storage_admin;

create table storage.buckets (
  id text not null,
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner_id text,
  constraint buckets_pkey primary key (id)
);
comment on column storage.buckets.owner is 'Field is deprecated, use owner_id instead';
create unique index bname on storage.buckets (name);

create table storage.objects (
  id uuid not null default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  owner_id text,
  user_metadata jsonb,
  constraint objects_pkey primary key (id),
  constraint "objects_bucketId_fkey" foreign key (bucket_id) references storage.buckets (id)
);
comment on column storage.objects.owner is 'Field is deprecated, use owner_id instead';
create unique index bucketid_objname on storage.objects (bucket_id, name);
create index name_prefix_search on storage.objects (name text_pattern_ops);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

-- Path helpers for policies: foldername('uid/foods/a.jpg') is {uid,foods}; the file name is not a folder.
create function storage.foldername(name text) returns text[]
language plpgsql
as $function$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[1:array_length(_parts,1)-1];
END
$function$;

create function storage.filename(name text) returns text
language plpgsql
as $function$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$function$;

create function storage.extension(name text) returns text
language plpgsql
as $function$
DECLARE
_parts text[];
_filename text;
BEGIN
	select string_to_array(name, '/') into _parts;
	select _parts[array_length(_parts,1)] into _filename;
	-- @todo return the last part instead of 2
	return reverse(split_part(reverse(_filename), '.', 1));
END
$function$;

create function storage.get_size_by_bucket() returns table (size bigint, bucket_id text)
language plpgsql
as $function$
BEGIN
    return query
        select sum((metadata->>'size')::int) as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$function$;

create function storage.operation() returns text
language plpgsql stable
as $function$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$function$;

create function storage.update_updated_at_column() returns trigger
language plpgsql
as $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;
create trigger update_objects_updated_at before update on storage.objects
  for each row execute function storage.update_updated_at_column();

create function storage.enforce_bucket_name_length() returns trigger
language plpgsql
as $function$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$function$;
create trigger enforce_bucket_name_length_trigger before insert or update of name on storage.buckets
  for each row execute function storage.enforce_bucket_name_length();

reset role;

-- The API roles reach storage through these grants; row level security decides which rows.
grant all on storage.buckets, storage.objects to postgres, anon, authenticated, service_role, dashboard_user;
grant all on all routines in schema storage to postgres, anon, authenticated, service_role, dashboard_user;

-- realtime ---------------------------------------------------------------------------------------------
-- Every project has this publication, empty until tables are added to it. (A local cluster without
-- wal_level = logical prints a warning here; nothing is ever replicated in tests.)
set client_min_messages = error;
create publication supabase_realtime;
reset client_min_messages;

-- The FITX project's own event-trigger function ---------------------------------------------------------
-- Exists in the hosted project but in no migration. There, an event trigger runs it after every
-- CREATE TABLE and it switches row level security on for new public tables. The function is here so
-- 20260924164105 can change its privileges; its event trigger is deliberately not installed (see the top).
create function public.rls_auto_enable() returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name = 'public' then
      execute format('alter table if exists %s enable row level security', cmd.object_identity);
    end if;
  end loop;
end;
$$;
