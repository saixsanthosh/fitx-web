-- Share links need the token RPC to be callable without a FITX account.
-- Keep it out of the authenticated role and index exercise references for deletes/updates.
revoke all on function public.get_activity_share(text) from authenticated;
grant execute on function public.get_activity_share(text) to anon;

create index if not exists exercise_favorites_exercise_idx
  on public.exercise_favorites (exercise_id);

