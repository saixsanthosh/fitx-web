-- Keep trigger-only functions out of Supabase's public Data API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- This project event trigger runs for DDL and only enables RLS on public tables.
-- Restrict direct RPC execution while keeping the installed event trigger intact.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Pin the trigger function's search path so it cannot be shadowed at runtime.
alter function public.touch_updated_at() set search_path = pg_catalog, public, pg_temp;
