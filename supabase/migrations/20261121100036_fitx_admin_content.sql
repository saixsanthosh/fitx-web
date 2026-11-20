-- FITX Admin content: workouts, nutrition, subscription plans and reports for Admin operators.
--
-- Adds no table. Changes, all additive and safe to run again:
--   * Storage: type and size limits on the public exercise-media bucket (photos and video loops), and a new
--     public food-media bucket for food photos. Files are uploaded only through signed upload URLs that the
--     Admin server makes with the service key; no storage policy is added, so members cannot write to either.
--   * Operator functions (security definer, search_path pinned, executable by service_role only). Each one
--     checks fitx_admin_op_can first and writes one audit row through fitx_admin_op_log_event:
--       exercises: save, delete (Admin-made and unused only), add and remove demonstration media;
--       programmes: publish or move back to draft (their content comes from src/data/programmes);
--       foods: save, show or hide, portions, photo, category rename;
--       subscription plans: create and edit names, descriptions, features and visibility (prices are fixed by
--       the Razorpay plan and never change here);
--     and read-only aggregates (counts only, never a member's rows): training vocabulary counts, food
--     categories and the reports.
-- Needs 20261121100030_fitx_admin_v2 (operators, fitx_admin_op_can, fitx_admin_op_log_event) and the
-- catalogue, food and billing migrations before it. Days are calendar days in India Standard Time.

do $do$ begin perform pg_catalog.set_config('lock_timeout', '5s', true); end $do$;

-- Storage --------------------------------------------------------------------------------------------

-- 50 MB is Supabase's default per-file ceiling; the Admin server holds photos to 5 MB and videos to 50 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-media', 'exercise-media', true, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4', 'video/webm']::text[])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types
where storage.buckets.public is distinct from excluded.public
   or storage.buckets.file_size_limit is distinct from excluded.file_size_limit
   or storage.buckets.allowed_mime_types is distinct from excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('food-media', 'food-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif']::text[])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types
where storage.buckets.public is distinct from excluded.public
   or storage.buckets.file_size_limit is distinct from excluded.file_size_limit
   or storage.buckets.allowed_mime_types is distinct from excluded.allowed_mime_types;

-- Helpers ----------------------------------------------------------------------------------------------

-- A JSON array of strings as trimmed, non-empty text values; null for anything that is not such an array.
create or replace function public.fitx_admin_content_text_array(p_value jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $function$
declare
  result text[];
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) = 'null' then
    return '{}'::text[];
  end if;
  if pg_catalog.jsonb_typeof(p_value) <> 'array' then
    return null;
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_value) as t (item) where pg_catalog.jsonb_typeof(item) <> 'string') then
    return null;
  end if;
  select coalesce(pg_catalog.array_agg(pg_catalog.btrim(item) order by ord), '{}'::text[]) into result
  from pg_catalog.jsonb_array_elements_text(p_value) with ordinality as t (item, ord)
  where pg_catalog.btrim(item) <> '';
  return result;
end;
$function$;

-- A stable id fragment from a name: lower case letters, digits and hyphens.
create or replace function public.fitx_admin_content_slug(p_value text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(coalesce(p_value, '')), '[^a-z0-9]+', '-', 'g'), '-'), 48);
$function$;

-- Exercises --------------------------------------------------------------------------------------------

-- Creates an exercise (p_exercise_id null) or updates one. New exercises get the id "fitx-<name>" and start
-- hidden unless is_active is true. Returns the id. Field rules match admin/src/lib/content/exercise-input.ts.
create or replace function public.fitx_admin_op_save_exercise(p_operator_id uuid, p_exercise_id text, p_exercise jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v jsonb := coalesce(p_exercise, '{}'::jsonb);
  old_row public.exercise_library%rowtype;
  target_id text;
  base_id text;
  suffix integer := 1;
  v_name text := pg_catalog.btrim(coalesce(v ->> 'name', ''));
  v_description text := pg_catalog.btrim(coalesce(v ->> 'description', ''));
  v_primary text := pg_catalog.btrim(coalesce(v ->> 'primary_muscle', ''));
  v_group text := nullif(pg_catalog.btrim(coalesce(v ->> 'muscle_group', '')), '');
  v_category text := nullif(pg_catalog.btrim(coalesce(v ->> 'category', '')), '');
  v_mechanic text := nullif(pg_catalog.btrim(coalesce(v ->> 'mechanic', '')), '');
  v_difficulty text := pg_catalog.btrim(coalesce(v ->> 'difficulty', ''));
  v_pattern text := pg_catalog.btrim(coalesce(v ->> 'movement_pattern', ''));
  v_prescription text := coalesce(nullif(pg_catalog.btrim(coalesce(v ->> 'prescription_type', '')), ''), 'reps');
  v_attribution text := pg_catalog.btrim(coalesce(v ->> 'attribution', ''));
  v_secondary text[] := public.fitx_admin_content_text_array(v -> 'secondary_muscles');
  v_required text[] := public.fitx_admin_content_text_array(v -> 'required_equipment');
  v_equipment text[] := public.fitx_admin_content_text_array(v -> 'equipment');
  v_locations text[] := public.fitx_admin_content_text_array(v -> 'locations');
  v_instructions text[] := public.fitx_admin_content_text_array(v -> 'instructions');
  v_sets integer;
  v_reps_min integer;
  v_reps_max integer;
  v_rest integer;
  v_duration integer;
  v_active boolean;
  changed text[] := '{}'::text[];
begin
  if not public.fitx_admin_op_can(p_operator_id, 'content.manage') then
    raise exception using errcode = '42501', message = 'Content permission required';
  end if;
  if pg_catalog.jsonb_typeof(v) <> 'object' then
    raise exception using errcode = '22023', message = 'Exercise details must be an object';
  end if;
  begin
    v_sets := (v ->> 'recommended_sets')::integer;
    v_reps_min := (v ->> 'reps_min')::integer;
    v_reps_max := (v ->> 'reps_max')::integer;
    v_rest := (v ->> 'rest_seconds')::integer;
    v_duration := nullif(v ->> 'default_duration_seconds', '')::integer;
    v_active := (v ->> 'is_active')::boolean;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'Numbers must be whole numbers';
  end;

  if pg_catalog.char_length(v_name) not between 2 and 120 then raise exception using errcode = '22023', message = 'Name must be 2 to 120 characters'; end if;
  if pg_catalog.char_length(v_description) > 2000 then raise exception using errcode = '22023', message = 'Description is too long'; end if;
  if v_primary !~ '^[a-z][a-z_]{1,39}$' then raise exception using errcode = '22023', message = 'Primary muscle is required'; end if;
  if v_group is null or v_group not in ('chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'core', 'quadriceps', 'hamstrings', 'glutes', 'calves', 'hips', 'neck', 'full_body') then
    raise exception using errcode = '22023', message = 'Muscle group is not known';
  end if;
  if v_category is not null and v_category not in ('strength', 'stretching', 'cardio', 'plyometrics', 'olympic', 'strongman') then
    raise exception using errcode = '22023', message = 'Category is not known';
  end if;
  if v_mechanic is not null and v_mechanic not in ('compound', 'isolation') then raise exception using errcode = '22023', message = 'Mechanic is not known'; end if;
  if v_difficulty not in ('beginner', 'intermediate', 'advanced') then raise exception using errcode = '22023', message = 'Difficulty is not known'; end if;
  if v_pattern !~ '^[a-z][a-z_]{1,39}$' then raise exception using errcode = '22023', message = 'Movement pattern is required'; end if;
  if v_prescription not in ('reps', 'time') then raise exception using errcode = '22023', message = 'Prescription is reps or time'; end if;
  if pg_catalog.char_length(v_attribution) not between 1 and 200 then raise exception using errcode = '22023', message = 'Credit line is required'; end if;
  if v_secondary is null or pg_catalog.cardinality(v_secondary) > 12 or exists (select 1 from pg_catalog.unnest(v_secondary) m where m !~ '^[a-z][a-z_]{1,39}$') then
    raise exception using errcode = '22023', message = 'Secondary muscles are not valid';
  end if;
  if v_required is null or pg_catalog.cardinality(v_required) > 12
     or exists (select 1 from pg_catalog.unnest(v_required) k where not exists (select 1 from public.equipment e where e.key = k)) then
    raise exception using errcode = '22023', message = 'Equipment is not known';
  end if;
  if v_equipment is null or pg_catalog.cardinality(v_equipment) > 12 or exists (select 1 from pg_catalog.unnest(v_equipment) k where pg_catalog.char_length(k) > 40) then
    raise exception using errcode = '22023', message = 'Equipment words are not valid';
  end if;
  if v_locations is null or pg_catalog.cardinality(v_locations) = 0 or not (v_locations <@ array['gym', 'home', 'outdoor']::text[]) then
    raise exception using errcode = '22023', message = 'Choose where it can be done';
  end if;
  if v_instructions is null or pg_catalog.cardinality(v_instructions) > 20 or exists (select 1 from pg_catalog.unnest(v_instructions) s where pg_catalog.char_length(s) > 500) then
    raise exception using errcode = '22023', message = 'Steps are not valid';
  end if;
  if v_sets is null or v_sets not between 1 and 10 then raise exception using errcode = '22023', message = 'Sets must be 1 to 10'; end if;
  if v_reps_min is null or v_reps_max is null or v_reps_min not between 1 and 100 or v_reps_max not between v_reps_min and 100 then
    raise exception using errcode = '22023', message = 'Reps must be 1 to 100, lowest first';
  end if;
  if v_rest is null or v_rest not between 15 and 600 then raise exception using errcode = '22023', message = 'Rest must be 15 to 600 seconds'; end if;
  if v_duration is not null and v_duration not between 5 and 7200 then raise exception using errcode = '22023', message = 'Duration must be 5 to 7200 seconds'; end if;
  if v_prescription = 'time' and v_duration is null then raise exception using errcode = '22023', message = 'A timed exercise needs a duration'; end if;

  if p_exercise_id is null then
    if exists (select 1 from public.exercise_library where pg_catalog.lower(name) = pg_catalog.lower(v_name)) then
      raise exception using errcode = '23505', message = 'An exercise with this name exists';
    end if;
    base_id := 'fitx-' || coalesce(nullif(public.fitx_admin_content_slug(v_name), ''), 'exercise');
    target_id := base_id;
    while exists (select 1 from public.exercise_library where id = target_id) loop
      suffix := suffix + 1;
      target_id := base_id || '-' || suffix;
    end loop;
    insert into public.exercise_library (id, name, description, primary_muscle, secondary_muscles, equipment, locations, difficulty,
      movement_pattern, instructions, recommended_sets, reps_min, reps_max, rest_seconds, attribution, is_active, category, mechanic,
      muscle_group, required_equipment, prescription_type, default_duration_seconds, catalog_version)
    values (target_id, v_name, v_description, v_primary, v_secondary, v_equipment, v_locations, v_difficulty, v_pattern, v_instructions,
      v_sets, v_reps_min, v_reps_max, v_rest, v_attribution, coalesce(v_active, false), v_category, v_mechanic, v_group, v_required,
      v_prescription, v_duration, 1);
    perform public.fitx_admin_op_log_event(p_operator_id, 'exercise_created', 'exercise', target_id,
      pg_catalog.jsonb_build_object('is_active', coalesce(v_active, false), 'muscle_group', v_group, 'category', v_category));
    return target_id;
  end if;

  select * into old_row from public.exercise_library where id = p_exercise_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Exercise not found';
  end if;
  if exists (select 1 from public.exercise_library where pg_catalog.lower(name) = pg_catalog.lower(v_name) and id <> p_exercise_id) then
    raise exception using errcode = '23505', message = 'An exercise with this name exists';
  end if;
  if old_row.name is distinct from v_name then changed := pg_catalog.array_append(changed, 'name'::text); end if;
  if old_row.description is distinct from v_description then changed := pg_catalog.array_append(changed, 'description'::text); end if;
  if old_row.primary_muscle is distinct from v_primary then changed := pg_catalog.array_append(changed, 'primary_muscle'::text); end if;
  if old_row.secondary_muscles is distinct from v_secondary then changed := pg_catalog.array_append(changed, 'secondary_muscles'::text); end if;
  if old_row.muscle_group is distinct from v_group then changed := pg_catalog.array_append(changed, 'muscle_group'::text); end if;
  if old_row.category is distinct from v_category then changed := pg_catalog.array_append(changed, 'category'::text); end if;
  if old_row.mechanic is distinct from v_mechanic then changed := pg_catalog.array_append(changed, 'mechanic'::text); end if;
  if old_row.difficulty is distinct from v_difficulty then changed := pg_catalog.array_append(changed, 'difficulty'::text); end if;
  if old_row.movement_pattern is distinct from v_pattern then changed := pg_catalog.array_append(changed, 'movement_pattern'::text); end if;
  if old_row.required_equipment is distinct from v_required or old_row.equipment is distinct from v_equipment then changed := pg_catalog.array_append(changed, 'equipment'::text); end if;
  if old_row.locations is distinct from v_locations then changed := pg_catalog.array_append(changed, 'locations'::text); end if;
  if old_row.instructions is distinct from v_instructions then changed := pg_catalog.array_append(changed, 'instructions'::text); end if;
  if old_row.recommended_sets is distinct from v_sets::smallint or old_row.reps_min is distinct from v_reps_min::smallint
     or old_row.reps_max is distinct from v_reps_max::smallint or old_row.rest_seconds is distinct from v_rest::smallint
     or old_row.prescription_type is distinct from v_prescription or old_row.default_duration_seconds is distinct from v_duration then
    changed := pg_catalog.array_append(changed, 'prescription'::text);
  end if;
  if old_row.attribution is distinct from v_attribution then changed := pg_catalog.array_append(changed, 'attribution'::text); end if;
  if pg_catalog.cardinality(changed) = 0 then
    return p_exercise_id;
  end if;

  update public.exercise_library set
    name = v_name, description = v_description, primary_muscle = v_primary, secondary_muscles = v_secondary,
    equipment = v_equipment, locations = v_locations, difficulty = v_difficulty, movement_pattern = v_pattern,
    instructions = v_instructions, recommended_sets = v_sets, reps_min = v_reps_min, reps_max = v_reps_max,
    rest_seconds = v_rest, attribution = v_attribution, category = v_category, mechanic = v_mechanic, muscle_group = v_group,
    required_equipment = v_required, prescription_type = v_prescription, default_duration_seconds = v_duration,
    catalog_version = greatest(catalog_version, 1)
  where id = p_exercise_id;
  perform public.fitx_admin_op_log_event(p_operator_id, 'exercise_updated', 'exercise', p_exercise_id,
    pg_catalog.jsonb_build_object('changed', pg_catalog.to_jsonb(changed)));
  return p_exercise_id;
end;
$function$;

-- Deletes an exercise made in Admin (id "fitx-…") that nothing uses: no member plan, session, record,
-- note or favourite, no programme slot and no other exercise points at it. Catalogue exercises are hidden
-- instead. Returns the Storage paths of its uploaded files, for the Admin server to remove.
create or replace function public.fitx_admin_op_delete_exercise(p_operator_id uuid, p_exercise_id text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  paths text[];
  media_count integer;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'content.manage') then
    raise exception using errcode = '42501', message = 'Content permission required';
  end if;
  perform 1 from public.exercise_library where id = p_exercise_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Exercise not found';
  end if;
  if p_exercise_id !~ '^fitx-' then
    raise exception using errcode = 'FXC02', message = 'Only exercises made in Admin can be deleted; hide catalogue exercises';
  end if;
  if exists (select 1 from public.workout_plan_exercises where exercise_id = p_exercise_id)
     or exists (select 1 from public.workout_session_exercises where exercise_id = p_exercise_id)
     or exists (select 1 from public.personal_records where exercise_id = p_exercise_id)
     or exists (select 1 from public.exercise_notes where exercise_id = p_exercise_id)
     or exists (select 1 from public.exercise_favorites where exercise_id = p_exercise_id)
     or exists (select 1 from public.exercise_library where id <> p_exercise_id and (merged_into = p_exercise_id or p_exercise_id = any (alternatives)))
     or exists (select 1 from public.training_programme_days where pg_catalog.strpos(slots::text, '"' || p_exercise_id || '"') > 0) then
    raise exception using errcode = 'FXC01', message = 'This exercise is in use; hide it instead';
  end if;
  select coalesce(pg_catalog.array_agg(storage_path) filter (where storage_path like 'admin/%'), '{}'::text[]), pg_catalog.count(*)::integer
  into paths, media_count
  from public.exercise_media where exercise_id = p_exercise_id;
  delete from public.exercise_library where id = p_exercise_id;
  perform public.fitx_admin_op_log_event(p_operator_id, 'exercise_deleted', 'exercise', p_exercise_id,
    pg_catalog.jsonb_build_object('media_removed', media_count));
  return paths;
end;
$function$;

-- Records a photo or video loop the Admin server has uploaded to exercise-media under
-- "admin/<exercise id>/" and checked. It goes after the exercise's other files of the same kind.
create or replace function public.fitx_admin_op_add_exercise_media(
  p_operator_id uuid,
  p_exercise_id text,
  p_kind text,
  p_storage_path text,
  p_alt text,
  p_attribution text,
  p_license text,
  p_width integer default null,
  p_height integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  next_position integer;
  new_id uuid;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'content.manage') then
    raise exception using errcode = '42501', message = 'Content permission required';
  end if;
  perform 1 from public.exercise_library where id = p_exercise_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Exercise not found';
  end if;
  if p_kind is null or p_kind not in ('still', 'video_loop') then
    raise exception using errcode = '22023', message = 'Media kind is still or video_loop';
  end if;
  if p_storage_path is null or pg_catalog.left(p_storage_path, pg_catalog.char_length(p_exercise_id) + 7) <> 'admin/' || p_exercise_id || '/'
     or p_storage_path !~ '^admin/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(jpg|png|webp|avif|mp4|webm)$' then
    raise exception using errcode = '22023', message = 'Storage path is not an Admin upload for this exercise';
  end if;
  if pg_catalog.char_length(coalesce(p_alt, '')) > 300 then raise exception using errcode = '22023', message = 'Description is too long'; end if;
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(p_attribution, ''))) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'Credit line is required';
  end if;
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(p_license, ''))) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Licence is required';
  end if;
  if (p_width is not null and p_width not between 1 and 10000) or (p_height is not null and p_height not between 1 and 10000) then
    raise exception using errcode = '22023', message = 'Size is not valid';
  end if;
  if exists (select 1 from public.exercise_media where storage_path = p_storage_path) then
    raise exception using errcode = '23505', message = 'This file is already recorded';
  end if;
  select coalesce(pg_catalog.max(position) + 1, 0) into next_position
  from public.exercise_media where exercise_id = p_exercise_id and kind = p_kind;
  if next_position > 20 then
    raise exception using errcode = 'FXC03', message = 'An exercise holds at most 21 files of one kind';
  end if;
  insert into public.exercise_media (exercise_id, kind, position, storage_path, source_url, mirrored_at, width, height, alt, attribution, license)
  values (p_exercise_id, p_kind, next_position, p_storage_path, null, pg_catalog.now(), p_width, p_height,
          pg_catalog.btrim(coalesce(p_alt, '')), pg_catalog.btrim(p_attribution), pg_catalog.btrim(p_license))
  returning id into new_id;
  perform public.fitx_admin_op_log_event(p_operator_id, 'exercise_media_added', 'exercise', p_exercise_id,
    pg_catalog.jsonb_build_object('kind', p_kind, 'position', next_position));
  return new_id;
end;
$function$;

-- Removes one media row. Returns its Storage path when it is an Admin upload (the server then deletes the
-- file); mirrored catalogue photos keep their files.
create or replace function public.fitx_admin_op_remove_exercise_media(p_operator_id uuid, p_media_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  removed public.exercise_media%rowtype;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'content.manage') then
    raise exception using errcode = '42501', message = 'Content permission required';
  end if;
  delete from public.exercise_media where id = p_media_id returning * into removed;
  if not found then
    raise exception using errcode = 'P0002', message = 'Media not found';
  end if;
  perform public.fitx_admin_op_log_event(p_operator_id, 'exercise_media_removed', 'exercise', removed.exercise_id,
    pg_catalog.jsonb_build_object('kind', removed.kind, 'position', removed.position));
  return case when removed.storage_path like 'admin/%' then removed.storage_path end;
end;
$function$;

-- Programmes -------------------------------------------------------------------------------------------

-- Publishes a programme or moves it back to draft. Members already following it keep reading it.
create or replace function public.fitx_admin_op_set_programme_status(p_operator_id uuid, p_programme_id text, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous text;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'content.manage') then
    raise exception using errcode = '42501', message = 'Content permission required';
  end if;
  if p_status is null or p_status not in ('draft', 'published') then
    raise exception using errcode = '22023', message = 'Status is draft or published';
  end if;
  select status into previous from public.training_programmes where id = p_programme_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Programme not found';
  end if;
  if previous = p_status then
    return;
  end if;
  update public.training_programmes set status = p_status, updated_at = pg_catalog.now() where id = p_programme_id;
  perform public.fitx_admin_op_log_event(p_operator_id, 'programme_status_updated', 'training_programme', p_programme_id,
    pg_catalog.jsonb_build_object('before', pg_catalog.jsonb_build_object('status', previous),
                                  'after', pg_catalog.jsonb_build_object('status', p_status)));
end;
$function$;

-- Counts for the Workouts screens: exercises per muscle group, category and equipment item, media totals
-- and active enrolments per programme. Counts only.
create or replace function public.fitx_admin_op_training_counts(p_operator_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'content.manage') then
    raise exception using errcode = '42501', message = 'Content permission required';
  end if;
  select pg_catalog.jsonb_build_object(
    'exercises', (select pg_catalog.jsonb_build_object('total', pg_catalog.count(*), 'active', pg_catalog.count(*) filter (where is_active),
        'admin_made', pg_catalog.count(*) filter (where id like 'fitx-%'), 'merged', pg_catalog.count(*) filter (where merged_into is not null))
      from public.exercise_library),
    'muscle_groups', (select coalesce(pg_catalog.jsonb_object_agg(g, pg_catalog.jsonb_build_object('total', total, 'active', active)), '{}'::jsonb)
      from (select coalesce(muscle_group, 'unset') as g, pg_catalog.count(*) as total, pg_catalog.count(*) filter (where is_active) as active
            from public.exercise_library group by 1) s),
    'categories', (select coalesce(pg_catalog.jsonb_object_agg(c, pg_catalog.jsonb_build_object('total', total, 'active', active)), '{}'::jsonb)
      from (select coalesce(category, 'unset') as c, pg_catalog.count(*) as total, pg_catalog.count(*) filter (where is_active) as active
            from public.exercise_library group by 1) s),
    'equipment', (select coalesce(pg_catalog.jsonb_object_agg(k, pg_catalog.jsonb_build_object('total', total, 'active', active)), '{}'::jsonb)
      from (select k, pg_catalog.count(*) as total, pg_catalog.count(*) filter (where e.is_active) as active
            from public.exercise_library e
            cross join lateral pg_catalog.unnest(case when pg_catalog.cardinality(e.required_equipment) = 0 then array['none']::text[] else e.required_equipment end) as k
            group by k) s),
    'media', (select pg_catalog.jsonb_build_object(
        'stills', pg_catalog.count(*) filter (where kind = 'still'),
        'videos', pg_catalog.count(*) filter (where kind = 'video_loop'),
        'uploaded', pg_catalog.count(*) filter (where storage_path like 'admin/%'),
        'exercises_with_video', pg_catalog.count(distinct exercise_id) filter (where kind = 'video_loop'))
      from public.exercise_media),
    'enrolments', (select coalesce(pg_catalog.jsonb_object_agg(programme_id, n), '{}'::jsonb)
      from (select programme_id, pg_catalog.count(*) as n from public.programme_enrolments where status = 'active' group by programme_id) s)
  ) into result;
  return result;
end;
$function$;

-- Foods ------------------------------------------------------------------------------------------------

-- Creates a food (p_food_id null; id "fitx-<name>", source fitx_admin) or updates one. Values are per 100 g.
-- Field rules match admin/src/lib/content/food-input.ts. Returns the id. Changing the nutrition values of a food
-- from another source (USDA FoodData Central) makes them FITX's own: the row becomes source fitx_admin with
-- licence FITX and no source id, data type or version, and its basis cannot stay lab analysed or compiled.
create or replace function public.fitx_admin_op_save_food(p_operator_id uuid, p_food_id text, p_food jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v jsonb := coalesce(p_food, '{}'::jsonb);
  old_row public.food_catalog%rowtype;
  target_id text;
  base_id text;
  suffix integer := 1;
  v_name text := pg_catalog.btrim(coalesce(v ->> 'name', ''));
  v_aliases text[] := public.fitx_admin_content_text_array(v -> 'aliases');
  v_keywords text[] := public.fitx_admin_content_text_array(v -> 'keywords');
  v_category text := nullif(pg_catalog.btrim(coalesce(v ->> 'category', '')), '');
  v_cuisine text := nullif(pg_catalog.btrim(coalesce(v ->> 'cuisine', '')), '');
  v_diet text := nullif(pg_catalog.btrim(coalesce(v ->> 'diet_type', '')), '');
  v_state text := nullif(pg_catalog.btrim(coalesce(v ->> 'state', '')), '');
  v_basis text := pg_catalog.btrim(coalesce(v ->> 'value_basis', ''));
  v_attribution text := nullif(pg_catalog.btrim(coalesce(v ->> 'attribution', '')), '');
  now_own boolean := false;
  v_kcal numeric;
  v_protein numeric;
  v_carbs numeric;
  v_fat numeric;
  v_fiber numeric;
  v_sugar numeric;
  v_sodium numeric;
  v_active boolean;
  changed text[] := '{}'::text[];
begin
  if not public.fitx_admin_op_can(p_operator_id, 'nutrition.manage') then
    raise exception using errcode = '42501', message = 'Nutrition permission required';
  end if;
  if pg_catalog.jsonb_typeof(v) <> 'object' then
    raise exception using errcode = '22023', message = 'Food details must be an object';
  end if;
  begin
    v_kcal := (v ->> 'kcal')::numeric;
    v_protein := (v ->> 'protein_g')::numeric;
    v_carbs := (v ->> 'carbs_g')::numeric;
    v_fat := (v ->> 'fat_g')::numeric;
    v_fiber := nullif(v ->> 'fiber_g', '')::numeric;
    v_sugar := nullif(v ->> 'sugar_g', '')::numeric;
    v_sodium := nullif(v ->> 'sodium_mg', '')::numeric;
    v_active := (v ->> 'is_active')::boolean;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'Values must be numbers';
  end;

  if pg_catalog.char_length(v_name) not between 2 and 200 then raise exception using errcode = '22023', message = 'Name must be 2 to 200 characters'; end if;
  if v_aliases is null or pg_catalog.cardinality(v_aliases) > 20 or exists (select 1 from pg_catalog.unnest(v_aliases) a where pg_catalog.char_length(a) > 60) then
    raise exception using errcode = '22023', message = 'Other names are not valid';
  end if;
  if v_keywords is null or pg_catalog.cardinality(v_keywords) > 30 or exists (select 1 from pg_catalog.unnest(v_keywords) k where pg_catalog.char_length(k) > 60) then
    raise exception using errcode = '22023', message = 'Search words are not valid';
  end if;
  if pg_catalog.char_length(coalesce(v_category, '')) > 120 then raise exception using errcode = '22023', message = 'Category is too long'; end if;
  if pg_catalog.char_length(coalesce(v_cuisine, '')) > 40 then raise exception using errcode = '22023', message = 'Cuisine is too long'; end if;
  if v_diet is not null and v_diet not in ('vegan', 'veg', 'egg', 'non_veg') then raise exception using errcode = '22023', message = 'Diet type is not known'; end if;
  if v_state is not null and v_state not in ('raw', 'cooked') then raise exception using errcode = '22023', message = 'State is raw or cooked'; end if;
  if v_basis not in ('lab_analysed', 'compiled', 'recipe_calculated', 'label', 'estimated') then
    raise exception using errcode = '22023', message = 'Say how the values were obtained';
  end if;
  if pg_catalog.char_length(coalesce(v_attribution, '')) > 300 then raise exception using errcode = '22023', message = 'Credit line is too long'; end if;
  if v_kcal is null or v_kcal < 0 or v_kcal > 950 then raise exception using errcode = '22023', message = 'Calories must be 0 to 950 kcal per 100 g'; end if;
  if v_protein is null or v_carbs is null or v_fat is null or least(v_protein, v_carbs, v_fat) < 0 or greatest(v_protein, v_carbs, v_fat) > 100 then
    raise exception using errcode = '22023', message = 'Protein, carbs and fat must be 0 to 100 g per 100 g';
  end if;
  if v_protein + v_carbs + v_fat > 100 then raise exception using errcode = '22023', message = 'Protein, carbs and fat add up to more than 100 g'; end if;
  if (v_fiber is not null and (v_fiber < 0 or v_fiber > 100)) or (v_sugar is not null and (v_sugar < 0 or v_sugar > 100)) then
    raise exception using errcode = '22023', message = 'Fibre and sugar must be 0 to 100 g per 100 g';
  end if;
  if v_sodium is not null and (v_sodium < 0 or v_sodium > 40000) then raise exception using errcode = '22023', message = 'Sodium must be 0 to 40000 mg per 100 g'; end if;

  if p_food_id is null then
    base_id := 'fitx-' || coalesce(nullif(public.fitx_admin_content_slug(v_name), ''), 'food');
    target_id := base_id;
    while exists (select 1 from public.food_catalog where id = target_id) loop
      suffix := suffix + 1;
      target_id := base_id || '-' || suffix;
    end loop;
    insert into public.food_catalog (id, name, aliases, keywords, category, cuisine, diet_type, state, kcal, protein_g, carbs_g, fat_g,
      fiber_g, sugar_g, sodium_mg, value_basis, source, source_ref, source_data_type, source_version, licence, attribution, is_active)
    values (target_id, v_name, v_aliases, v_keywords, v_category, v_cuisine, v_diet, v_state, v_kcal, v_protein, v_carbs, v_fat,
      v_fiber, v_sugar, v_sodium, v_basis, 'fitx_admin', null, null, null, 'FITX', v_attribution, coalesce(v_active, false));
    perform public.fitx_admin_op_log_event(p_operator_id, 'food_created', 'food', target_id,
      pg_catalog.jsonb_build_object('is_active', coalesce(v_active, false), 'value_basis', v_basis));
    return target_id;
  end if;

  select * into old_row from public.food_catalog where id = p_food_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Food not found';
  end if;
  if old_row.name is distinct from v_name then changed := pg_catalog.array_append(changed, 'name'::text); end if;
  -- The catalogue trigger stores search words in lower case without a fixed order, so compare them as sets.
  if (select pg_catalog.array_agg(x order by x) from pg_catalog.unnest(old_row.aliases) x)
       is distinct from (select pg_catalog.array_agg(distinct pg_catalog.lower(x) order by pg_catalog.lower(x)) from pg_catalog.unnest(v_aliases) x)
     or (select pg_catalog.array_agg(x order by x) from pg_catalog.unnest(old_row.keywords) x)
       is distinct from (select pg_catalog.array_agg(distinct pg_catalog.lower(x) order by pg_catalog.lower(x)) from pg_catalog.unnest(v_keywords) x) then
    changed := pg_catalog.array_append(changed, 'search_words'::text);
  end if;
  if old_row.category is distinct from v_category then changed := pg_catalog.array_append(changed, 'category'::text); end if;
  if old_row.cuisine is distinct from v_cuisine then changed := pg_catalog.array_append(changed, 'cuisine'::text); end if;
  if old_row.diet_type is distinct from v_diet then changed := pg_catalog.array_append(changed, 'diet_type'::text); end if;
  if old_row.state is distinct from v_state then changed := pg_catalog.array_append(changed, 'state'::text); end if;
  if old_row.kcal is distinct from v_kcal::numeric(7,2) or old_row.protein_g is distinct from v_protein::numeric(6,2)
     or old_row.carbs_g is distinct from v_carbs::numeric(6,2) or old_row.fat_g is distinct from v_fat::numeric(6,2) then
    changed := pg_catalog.array_append(changed, 'macros'::text);
  end if;
  if old_row.fiber_g is distinct from v_fiber::numeric(6,2) or old_row.sugar_g is distinct from v_sugar::numeric(6,2)
     or old_row.sodium_mg is distinct from v_sodium::numeric(8,2) then
    changed := pg_catalog.array_append(changed, 'other_nutrients'::text);
  end if;
  if old_row.value_basis is distinct from v_basis then changed := pg_catalog.array_append(changed, 'value_basis'::text); end if;
  if old_row.attribution is distinct from v_attribution then changed := pg_catalog.array_append(changed, 'attribution'::text); end if;
  if pg_catalog.cardinality(changed) = 0 then
    return p_food_id;
  end if;
  -- New values on another source's food are no longer that source's numbers.
  if old_row.source is distinct from 'fitx_admin' and changed && array['macros', 'other_nutrients']::text[] then
    if v_basis in ('lab_analysed', 'compiled') then
      raise exception using errcode = '22023',
        message = 'Changed values are no longer the source''s. Choose Calculated from a recipe, Label or Estimate';
    end if;
    now_own := true;
    changed := pg_catalog.array_append(changed, 'source'::text);
  end if;
  update public.food_catalog set
    name = v_name, aliases = v_aliases, keywords = v_keywords, category = v_category, cuisine = v_cuisine, diet_type = v_diet,
    state = v_state, kcal = v_kcal, protein_g = v_protein, carbs_g = v_carbs, fat_g = v_fat, fiber_g = v_fiber, sugar_g = v_sugar,
    sodium_mg = v_sodium, value_basis = v_basis, attribution = v_attribution,
    source = case when now_own then 'fitx_admin' else source end,
    source_ref = case when now_own then null else source_ref end,
    source_data_type = case when now_own then null else source_data_type end,
    source_version = case when now_own then null else source_version end,
    licence = case when now_own then 'FITX' else licence end
  where id = p_food_id;
  perform public.fitx_admin_op_log_event(p_operator_id, 'food_updated', 'food', p_food_id,
    pg_catalog.jsonb_build_object('changed', pg_catalog.to_jsonb(changed)));
  return p_food_id;
end;
$function$;

create or replace function public.fitx_admin_op_set_food_active(p_operator_id uuid, p_food_id text, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous boolean;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'nutrition.manage') then
    raise exception using errcode = '42501', message = 'Nutrition permission required';
  end if;
  if p_is_active is null then
    raise exception using errcode = '22023', message = 'Visibility is required';
  end if;
  select is_active into previous from public.food_catalog where id = p_food_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Food not found';
  end if;
  if previous = p_is_active then
    return;
  end if;
  update public.food_catalog set is_active = p_is_active where id = p_food_id;
  perform public.fitx_admin_op_log_event(p_operator_id, 'food_visibility_updated', 'food', p_food_id,
    pg_catalog.jsonb_build_object('before', pg_catalog.jsonb_build_object('is_active', previous),
                                  'after', pg_catalog.jsonb_build_object('is_active', p_is_active)));
end;
$function$;

-- Replaces a food's household portions with p_portions, a JSON array of
-- { label, unit, grams, is_default, is_estimate } (at most 12, at most one default, labels unique).
-- A portion that keeps its label keeps its source. Returns the number of portions.
create or replace function public.fitx_admin_op_set_food_portions(p_operator_id uuid, p_food_id text, p_portions jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  before_count integer;
  after_count integer;
  old_sources jsonb;
  item jsonb;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'nutrition.manage') then
    raise exception using errcode = '42501', message = 'Nutrition permission required';
  end if;
  perform 1 from public.food_catalog where id = p_food_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Food not found';
  end if;
  if p_portions is null or pg_catalog.jsonb_typeof(p_portions) <> 'array' or pg_catalog.jsonb_array_length(p_portions) > 12 then
    raise exception using errcode = '22023', message = 'Portions must be a list of at most 12';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_portions) loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
       or pg_catalog.char_length(pg_catalog.btrim(coalesce(item ->> 'label', ''))) not between 1 and 120
       or coalesce(item ->> 'unit', '') not in ('piece', 'slice', 'serving', 'cup', 'tbsp', 'tsp', 'ml', 'l', 'floz', 'katori', 'bowl', 'plate', 'glass')
       or coalesce(item ->> 'grams', '') !~ '^[0-9]{1,4}(\.[0-9]{1,2})?$'
       or (item ->> 'grams')::numeric <= 0 or (item ->> 'grams')::numeric > 5000
       or pg_catalog.jsonb_typeof(coalesce(item -> 'is_default', 'false'::jsonb)) <> 'boolean'
       or pg_catalog.jsonb_typeof(coalesce(item -> 'is_estimate', 'true'::jsonb)) <> 'boolean' then
      raise exception using errcode = '22023', message = 'A portion needs a label, a unit and grams from 0.01 to 5000';
    end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_portions) p where coalesce((p ->> 'is_default')::boolean, false)) > 1 then
    raise exception using errcode = '22023', message = 'Only one portion can be the default';
  end if;
  if (select pg_catalog.count(distinct pg_catalog.lower(pg_catalog.btrim(p ->> 'label'))) from pg_catalog.jsonb_array_elements(p_portions) p)
     <> pg_catalog.jsonb_array_length(p_portions) then
    raise exception using errcode = '22023', message = 'Portion labels must differ';
  end if;

  select pg_catalog.count(*)::integer, coalesce(pg_catalog.jsonb_object_agg(fp.label, fp.source), '{}'::jsonb)
  into before_count, old_sources
  from public.food_portions fp where fp.food_id = p_food_id;
  delete from public.food_portions where food_id = p_food_id;
  insert into public.food_portions (food_id, label, unit, grams, is_default, is_estimate, source, sort_order)
  select p_food_id, pg_catalog.btrim(p.value ->> 'label'), p.value ->> 'unit', (p.value ->> 'grams')::numeric,
         coalesce((p.value ->> 'is_default')::boolean, false), coalesce((p.value ->> 'is_estimate')::boolean, true),
         coalesce(old_sources ->> pg_catalog.btrim(p.value ->> 'label'), 'fitx_admin'),
         (p.ordinality - 1)::smallint
  from pg_catalog.jsonb_array_elements(p_portions) with ordinality as p (value, ordinality);
  get diagnostics after_count = row_count;
  perform public.fitx_admin_op_log_event(p_operator_id, 'food_portions_updated', 'food', p_food_id,
    pg_catalog.jsonb_build_object('before', pg_catalog.jsonb_build_object('portions', before_count),
                                  'after', pg_catalog.jsonb_build_object('portions', after_count)));
  return after_count;
end;
$function$;

-- Sets a food's photo to a file uploaded to the food-media bucket, with its licence and credit, or clears it
-- (p_image_url null). Returns the previous URL so the server can delete a replaced upload.
create or replace function public.fitx_admin_op_set_food_image(
  p_operator_id uuid,
  p_food_id text,
  p_image_url text,
  p_license text,
  p_attribution text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous text;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'nutrition.manage') then
    raise exception using errcode = '42501', message = 'Nutrition permission required';
  end if;
  select image_url into previous from public.food_catalog where id = p_food_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Food not found';
  end if;
  if p_image_url is null then
    update public.food_catalog set image_url = null, image_license = null, image_attribution = null where id = p_food_id;
    perform public.fitx_admin_op_log_event(p_operator_id, 'food_image_updated', 'food', p_food_id, pg_catalog.jsonb_build_object('image', 'removed'));
    return previous;
  end if;
  if pg_catalog.char_length(p_image_url) > 500
     or p_image_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/food-media/admin/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(jpg|png|webp|avif)$'
     or pg_catalog.split_part(pg_catalog.split_part(p_image_url, '/food-media/admin/', 2), '/', 1) <> p_food_id then
    raise exception using errcode = '22023', message = 'The photo must be an Admin upload for this food';
  end if;
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(p_license, ''))) not between 1 and 120
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_attribution, ''))) not between 1 and 300 then
    raise exception using errcode = '22023', message = 'A photo needs a licence and a credit line';
  end if;
  update public.food_catalog set image_url = p_image_url, image_license = pg_catalog.btrim(p_license), image_attribution = pg_catalog.btrim(p_attribution)
  where id = p_food_id;
  perform public.fitx_admin_op_log_event(p_operator_id, 'food_image_updated', 'food', p_food_id,
    pg_catalog.jsonb_build_object('image', case when previous is null then 'added' else 'replaced' end));
  return previous;
end;
$function$;

-- Renames a food category on every food that has it (p_to null clears it). Returns the number of foods.
create or replace function public.fitx_admin_op_rename_food_category(p_operator_id uuid, p_from text, p_to text)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_to text := nullif(pg_catalog.btrim(coalesce(p_to, '')), '');
  moved integer;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'nutrition.manage') then
    raise exception using errcode = '42501', message = 'Nutrition permission required';
  end if;
  if p_from is null or pg_catalog.char_length(p_from) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Choose a category';
  end if;
  if pg_catalog.char_length(coalesce(v_to, '')) > 120 then
    raise exception using errcode = '22023', message = 'Category is too long';
  end if;
  if v_to is not distinct from p_from then
    return 0;
  end if;
  update public.food_catalog set category = v_to where category = p_from;
  get diagnostics moved = row_count;
  if moved = 0 then
    raise exception using errcode = 'P0002', message = 'No food has this category';
  end if;
  perform public.fitx_admin_op_log_event(p_operator_id, 'food_category_renamed', 'food_category', pg_catalog.left(p_from, 200),
    pg_catalog.jsonb_build_object('foods', moved, 'cleared', v_to is null));
  return moved;
end;
$function$;

-- Food categories with the number of foods in each (all and shown). Counts only.
create or replace function public.fitx_admin_op_food_categories(p_operator_id uuid)
returns table (category text, foods integer, active integer)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.fitx_admin_op_can(p_operator_id, 'nutrition.manage') then
    raise exception using errcode = '42501', message = 'Nutrition permission required';
  end if;
  return query
    select f.category, pg_catalog.count(*)::integer, (pg_catalog.count(*) filter (where f.is_active))::integer
    from public.food_catalog f
    group by f.category
    order by pg_catalog.count(*) desc, f.category nulls last;
end;
$function$;

-- Subscription plans -----------------------------------------------------------------------------------

-- Creates a plan (code not yet used) or edits one. On an existing plan only the name, description,
-- features, visibility, order and a missing Razorpay plan id change: the price, currency and period stay,
-- because Razorpay fixes them on its plan. Returns the code.
create or replace function public.fitx_admin_op_save_billing_plan(p_operator_id uuid, p_code text, p_plan jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v jsonb := coalesce(p_plan, '{}'::jsonb);
  old_row public.billing_plans%rowtype;
  v_code text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_code, '')));
  v_name text := pg_catalog.btrim(coalesce(v ->> 'name', ''));
  v_description text := nullif(pg_catalog.btrim(coalesce(v ->> 'description', '')), '');
  v_features text[] := public.fitx_admin_content_text_array(v -> 'features');
  v_test text := nullif(pg_catalog.btrim(coalesce(v ->> 'razorpay_plan_id_test', '')), '');
  v_live text := nullif(pg_catalog.btrim(coalesce(v ->> 'razorpay_plan_id_live', '')), '');
  v_period text := pg_catalog.btrim(coalesce(v ->> 'billing_period', ''));
  v_amount integer;
  v_interval integer;
  v_sort integer;
  v_active boolean;
  changed text[] := '{}'::text[];
begin
  if not public.fitx_admin_op_can(p_operator_id, 'billing.manage') then
    raise exception using errcode = '42501', message = 'Billing permission required';
  end if;
  if pg_catalog.jsonb_typeof(v) <> 'object' then
    raise exception using errcode = '22023', message = 'Plan details must be an object';
  end if;
  begin
    v_amount := nullif(v ->> 'amount_paise', '')::integer;
    v_interval := coalesce(nullif(v ->> 'billing_interval', '')::integer, 1);
    v_sort := coalesce(nullif(v ->> 'sort_order', '')::integer, 0);
    v_active := coalesce((v ->> 'is_active')::boolean, false);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'Numbers must be whole numbers';
  end;
  if v_code !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception using errcode = '22023', message = 'Code is 2 to 40 lower-case letters, digits or hyphens'; end if;
  if pg_catalog.char_length(v_name) not between 1 and 60 then raise exception using errcode = '22023', message = 'Name must be 1 to 60 characters'; end if;
  if pg_catalog.char_length(coalesce(v_description, '')) > 300 then raise exception using errcode = '22023', message = 'Description is too long'; end if;
  if v_features is null or pg_catalog.cardinality(v_features) > 10 or pg_catalog.char_length(pg_catalog.array_to_string(v_features, '')) > 1200 then
    raise exception using errcode = '22023', message = 'At most 10 features, 1200 characters in all';
  end if;
  if (v_test is not null and v_test !~ '^plan_[A-Za-z0-9]{1,60}$') or (v_live is not null and v_live !~ '^plan_[A-Za-z0-9]{1,60}$') then
    raise exception using errcode = '22023', message = 'A Razorpay plan id looks like plan_…';
  end if;
  if v_sort not between -1000 and 1000 then raise exception using errcode = '22023', message = 'Order must be -1000 to 1000'; end if;

  select * into old_row from public.billing_plans where code = v_code for update;
  if not found then
    if v_amount is null or v_amount not between 100 and 10000000 then
      raise exception using errcode = '22023', message = 'Price must be ₹1 to ₹1,00,000';
    end if;
    if v_period not in ('monthly', 'yearly') or (v_period = 'monthly' and v_interval not between 1 and 12) or (v_period = 'yearly' and v_interval <> 1) then
      raise exception using errcode = '22023', message = 'Period is monthly (every 1 to 12 months) or yearly';
    end if;
    if (v_test is not null and exists (select 1 from public.billing_plans where razorpay_plan_id_test = v_test))
       or (v_live is not null and exists (select 1 from public.billing_plans where razorpay_plan_id_live = v_live)) then
      raise exception using errcode = '23505', message = 'That Razorpay plan id is already used';
    end if;
    insert into public.billing_plans (code, name, description, features, amount_paise, currency, billing_period, billing_interval,
      razorpay_plan_id_test, razorpay_plan_id_live, is_active, sort_order)
    values (v_code, v_name, v_description, v_features, v_amount, 'INR', v_period, v_interval, v_test, v_live, v_active, v_sort);
    perform public.fitx_admin_op_log_event(p_operator_id, 'billing_plan_created', 'billing_plan', v_code,
      pg_catalog.jsonb_build_object('amount_paise', v_amount, 'billing_period', v_period, 'billing_interval', v_interval, 'is_active', v_active));
    return v_code;
  end if;

  if v_amount is not null and v_amount <> old_row.amount_paise then
    raise exception using errcode = 'FXC04', message = 'A plan''s price is fixed by its Razorpay plan; make a new plan instead';
  end if;
  if old_row.razorpay_plan_id_test is not null and v_test is distinct from old_row.razorpay_plan_id_test then
    raise exception using errcode = 'FXC04', message = 'A Razorpay plan id cannot be changed once set';
  end if;
  if old_row.razorpay_plan_id_live is not null and v_live is distinct from old_row.razorpay_plan_id_live then
    raise exception using errcode = 'FXC04', message = 'A Razorpay plan id cannot be changed once set';
  end if;
  if (v_test is not null and old_row.razorpay_plan_id_test is null and exists (select 1 from public.billing_plans where razorpay_plan_id_test = v_test))
     or (v_live is not null and old_row.razorpay_plan_id_live is null and exists (select 1 from public.billing_plans where razorpay_plan_id_live = v_live)) then
    raise exception using errcode = '23505', message = 'That Razorpay plan id is already used';
  end if;
  if old_row.name is distinct from v_name then changed := pg_catalog.array_append(changed, 'name'::text); end if;
  if old_row.description is distinct from v_description then changed := pg_catalog.array_append(changed, 'description'::text); end if;
  if old_row.features is distinct from v_features then changed := pg_catalog.array_append(changed, 'features'::text); end if;
  if old_row.is_active is distinct from v_active then changed := pg_catalog.array_append(changed, 'is_active'::text); end if;
  if old_row.sort_order is distinct from v_sort then changed := pg_catalog.array_append(changed, 'sort_order'::text); end if;
  if old_row.razorpay_plan_id_test is distinct from v_test then changed := pg_catalog.array_append(changed, 'razorpay_plan_id_test'::text); end if;
  if old_row.razorpay_plan_id_live is distinct from v_live then changed := pg_catalog.array_append(changed, 'razorpay_plan_id_live'::text); end if;
  if pg_catalog.cardinality(changed) = 0 then
    return v_code;
  end if;
  update public.billing_plans set name = v_name, description = v_description, features = v_features, is_active = v_active,
    sort_order = v_sort, razorpay_plan_id_test = v_test, razorpay_plan_id_live = v_live, updated_at = pg_catalog.now()
  where code = v_code;
  perform public.fitx_admin_op_log_event(p_operator_id, 'billing_plan_updated', 'billing_plan', v_code,
    pg_catalog.jsonb_build_object('changed', pg_catalog.to_jsonb(changed), 'is_active', v_active));
  return v_code;
end;
$function$;

-- Reports ------------------------------------------------------------------------------------------------

-- Everything the Reports screen shows, for the last p_days IST days (7 to 365, default 90) and the last 12
-- IST months. Accounts and "active" follow fitx_admin_metrics (20261118180003): Auth accounts
-- that are not deleted, not anonymous and not Admin team members; active means a workout, set, meal, water
-- entry, body measurement, goal progress entry or walk, run or ride saved that day. Counts and sums only; revenue is live-mode Razorpay records only.
create or replace function public.fitx_admin_op_report(p_operator_id uuid, p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  span integer := least(greatest(coalesce(p_days, 90), 7), 365);
  today date := (pg_catalog.now() at time zone 'Asia/Kolkata')::date;
  first_day date;
  start_at timestamptz;
  window_start timestamptz;
  first_month date;
  month_start timestamptz;
  result jsonb;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'reports.view') then
    raise exception using errcode = '42501', message = 'Reports permission required';
  end if;
  first_day := today - (span - 1);
  start_at := first_day::timestamp at time zone 'Asia/Kolkata';
  window_start := (first_day - 29)::timestamp at time zone 'Asia/Kolkata';
  first_month := (pg_catalog.date_trunc('month', today::timestamp) - interval '11 months')::date;
  month_start := first_month::timestamp at time zone 'Asia/Kolkata';

  with
  accounts as (
    select u.id, u.created_at
    from auth.users u
    where u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and not exists (select 1 from public.fitx_admin_members m where m.user_id = u.id)
  ),
  activity as (
    select user_id, created_at from public.workout_sessions where created_at >= window_start
    union all select user_id, created_at from public.workout_sets where created_at >= window_start
    union all select user_id, created_at from public.meals where created_at >= window_start
    union all select user_id, created_at from public.water_logs where created_at >= window_start
    union all select user_id, created_at from public.body_metrics where created_at >= window_start
    union all select user_id, created_at from public.goal_progress_entries where created_at >= window_start
    union all select user_id, created_at from public.activities where created_at >= window_start
  ),
  active_days as (
    select distinct act.user_id, (act.created_at at time zone 'Asia/Kolkata')::date as day
    from activity act join accounts a on a.id = act.user_id
  ),
  series as (
    select pg_catalog.generate_series(first_day, today, interval '1 day')::date as day
  ),
  rolling as (
    select s.day,
           pg_catalog.count(distinct ad.user_id) filter (where ad.day = s.day) as dau,
           pg_catalog.count(distinct ad.user_id) filter (where ad.day > s.day - 7) as wau,
           pg_catalog.count(distinct ad.user_id) as mau
    from series s
    left join active_days ad on ad.day between s.day - 29 and s.day
    group by s.day
  ),
  new_daily as (
    select (a.created_at at time zone 'Asia/Kolkata')::date as day, pg_catalog.count(*) as n
    from accounts a where a.created_at >= start_at group by 1
  ),
  sessions as (
    select s.user_id, s.id, s.status, s.started_at, s.duration_seconds, (s.started_at at time zone 'Asia/Kolkata')::date as day
    from public.workout_sessions s join accounts a on a.id = s.user_id
    where s.started_at >= start_at
  ),
  workouts_daily as (
    select day, pg_catalog.count(*) filter (where status = 'completed') as completed,
           pg_catalog.count(distinct user_id) filter (where status = 'completed') as members
    from sessions group by day
  ),
  sets_daily as (
    select (ws.created_at at time zone 'Asia/Kolkata')::date as day, pg_catalog.count(*) as n
    from public.workout_sets ws join accounts a on a.id = ws.user_id
    where ws.created_at >= start_at group by 1
  ),
  meals_in_range as (
    select ml.user_id, ml.source, ml.barcode, ml.meal, (ml.created_at at time zone 'Asia/Kolkata')::date as day
    from public.meals ml join accounts a on a.id = ml.user_id
    where ml.created_at >= start_at
  ),
  meals_daily as (
    select day, pg_catalog.count(*) as n, pg_catalog.count(distinct user_id) as members from meals_in_range group by day
  ),
  water_daily as (
    select (w.created_at at time zone 'Asia/Kolkata')::date as day, pg_catalog.count(*) as n
    from public.water_logs w join accounts a on a.id = w.user_id
    where w.created_at >= start_at group by 1
  ),
  activities_in_range as (
    select act.user_id, act.sport, (act.started_at at time zone 'Asia/Kolkata')::date as day
    from public.activities act join accounts a on a.id = act.user_id
    where act.started_at >= start_at
  ),
  activities_daily as (
    select day, pg_catalog.count(*) as n from activities_in_range group by day
  ),
  months as (
    select pg_catalog.generate_series(first_month, pg_catalog.date_trunc('month', today::timestamp)::date, interval '1 month')::date as month
  ),
  live_payments as (
    select p.subscription_id, p.status, p.amount_paise, p.captured_at, p.created_at
    from public.billing_payments p where p.mode = 'live'
  ),
  first_capture as (
    select subscription_id, pg_catalog.min(captured_at) as at
    from live_payments where subscription_id is not null and captured_at is not null and status in ('captured', 'refunded')
    group by subscription_id
  ),
  monthly as (
    select m.month,
      (select pg_catalog.count(*) from accounts a
        where (a.created_at at time zone 'Asia/Kolkata')::date >= m.month and (a.created_at at time zone 'Asia/Kolkata')::date < (m.month + interval '1 month')::date) as new_accounts,
      (select pg_catalog.count(*) from first_capture f
        where (f.at at time zone 'Asia/Kolkata')::date >= m.month and (f.at at time zone 'Asia/Kolkata')::date < (m.month + interval '1 month')::date) as subscriptions_started,
      (select pg_catalog.count(*) from public.billing_subscriptions bs
        where bs.mode = 'live' and bs.cancel_requested_at is not null
          and (bs.cancel_requested_at at time zone 'Asia/Kolkata')::date >= m.month and (bs.cancel_requested_at at time zone 'Asia/Kolkata')::date < (m.month + interval '1 month')::date) as cancellations,
      (select coalesce(pg_catalog.sum(lp.amount_paise), 0) from live_payments lp
        where lp.status in ('captured', 'refunded') and lp.captured_at is not null
          and (lp.captured_at at time zone 'Asia/Kolkata')::date >= m.month and (lp.captured_at at time zone 'Asia/Kolkata')::date < (m.month + interval '1 month')::date) as captured_paise,
      (select pg_catalog.count(*) from live_payments lp
        where lp.status in ('captured', 'refunded') and lp.captured_at is not null
          and (lp.captured_at at time zone 'Asia/Kolkata')::date >= m.month and (lp.captured_at at time zone 'Asia/Kolkata')::date < (m.month + interval '1 month')::date) as payments_captured,
      (select pg_catalog.count(*) from live_payments lp
        where lp.status = 'failed'
          and (lp.created_at at time zone 'Asia/Kolkata')::date >= m.month and (lp.created_at at time zone 'Asia/Kolkata')::date < (m.month + interval '1 month')::date) as payments_failed,
      (select coalesce(pg_catalog.sum(r.amount_paise), 0) from public.billing_refunds r
        where r.mode = 'live' and r.status = 'processed' and r.processed_at is not null
          and (r.processed_at at time zone 'Asia/Kolkata')::date >= m.month and (r.processed_at at time zone 'Asia/Kolkata')::date < (m.month + interval '1 month')::date) as refunded_paise
    from months m
  )
  select pg_catalog.jsonb_build_object(
    'generated_at', pg_catalog.now(),
    'days', span,
    'from', first_day,
    'to', today,
    'accounts_total', (select pg_catalog.count(*) from accounts),
    'accounts_before', (select pg_catalog.count(*) from accounts where created_at < start_at),
    'daily', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'day', s.day,
        'new_accounts', coalesce(nd.n, 0),
        'dau', coalesce(r.dau, 0),
        'wau', coalesce(r.wau, 0),
        'mau', coalesce(r.mau, 0),
        'workouts_completed', coalesce(wd.completed, 0),
        'workout_members', coalesce(wd.members, 0),
        'sets_logged', coalesce(sd.n, 0),
        'meals_logged', coalesce(md.n, 0),
        'meal_members', coalesce(md.members, 0),
        'water_entries', coalesce(wa.n, 0),
        'activities_recorded', coalesce(ac.n, 0)
      ) order by s.day), '[]'::jsonb)
      from series s
      left join rolling r on r.day = s.day
      left join new_daily nd on nd.day = s.day
      left join workouts_daily wd on wd.day = s.day
      left join sets_daily sd on sd.day = s.day
      left join meals_daily md on md.day = s.day
      left join water_daily wa on wa.day = s.day
      left join activities_daily ac on ac.day = s.day
    ),
    'workouts', pg_catalog.jsonb_build_object(
      'completed', (select pg_catalog.count(*) from sessions where status = 'completed'),
      'abandoned', (select pg_catalog.count(*) from sessions where status = 'abandoned'),
      'members', (select pg_catalog.count(distinct user_id) from sessions where status = 'completed'),
      'avg_minutes', (select pg_catalog.round(pg_catalog.avg(duration_seconds) / 60.0, 1) from sessions where status = 'completed' and duration_seconds > 0),
      'top_exercises', (
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('exercise_id', t.exercise_id, 'name', t.name, 'sessions', t.sessions, 'members', t.members)
               order by t.sessions desc, t.name), '[]'::jsonb)
        from (
          select e.exercise_id, el.name, pg_catalog.count(distinct e.session_id) as sessions, pg_catalog.count(distinct e.user_id) as members
          from public.workout_session_exercises e
          join sessions s on s.id = e.session_id and s.status = 'completed'
          join public.exercise_library el on el.id = e.exercise_id
          group by e.exercise_id, el.name
          order by 3 desc, el.name
          limit 10
        ) t
      ),
      'activities_by_sport', (
        select coalesce(pg_catalog.jsonb_object_agg(sport, n), '{}'::jsonb)
        from (select sport, pg_catalog.count(*) as n from activities_in_range group by sport) x
      ),
      'programme_enrolments_active', (
        select pg_catalog.count(*) from public.programme_enrolments pe join accounts a on a.id = pe.user_id where pe.status = 'active'
      ),
      'programme_enrolments_started', (
        select pg_catalog.count(*) from public.programme_enrolments pe join accounts a on a.id = pe.user_id where pe.created_at >= start_at
      )
    ),
    'nutrition', pg_catalog.jsonb_build_object(
      'meals', (select pg_catalog.count(*) from meals_in_range),
      'members', (select pg_catalog.count(distinct user_id) from meals_in_range),
      'barcode_meals', (select pg_catalog.count(*) from meals_in_range where barcode is not null and barcode <> ''),
      'by_source', (
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('source', x.source, 'meals', x.n) order by x.n desc, x.source), '[]'::jsonb)
        from (
          select pg_catalog.left(coalesce(nullif(pg_catalog.btrim(source), ''), 'manual'), 40) as source, pg_catalog.count(*) as n
          from meals_in_range group by 1 order by 2 desc, 1 limit 8
        ) x
      ),
      'by_slot', (
        select coalesce(pg_catalog.jsonb_object_agg(slot, n), '{}'::jsonb)
        from (
          select case when meal in ('Breakfast', 'Lunch', 'Dinner', 'Snack') then meal else 'Other' end as slot, pg_catalog.count(*) as n
          from meals_in_range group by 1
        ) x
      ),
      'custom_foods_created', (
        select pg_catalog.count(*) from public.custom_foods cf join accounts a on a.id = cf.user_id where cf.created_at >= start_at
      ),
      'saved_meals_created', (
        select pg_catalog.count(*) from public.meal_templates mt join accounts a on a.id = mt.user_id where mt.kind = 'meal' and mt.created_at >= start_at
      ),
      'routines_created', (
        select pg_catalog.count(*) from public.meal_templates mt join accounts a on a.id = mt.user_id where mt.kind = 'day' and mt.created_at >= start_at
      ),
      'water_entries', (select coalesce(pg_catalog.sum(n), 0) from water_daily)
    ),
    'subscriptions', pg_catalog.jsonb_build_object(
      'by_status', (
        select coalesce(pg_catalog.jsonb_object_agg(status, n), '{}'::jsonb)
        from (select status, pg_catalog.count(*) as n from public.billing_subscriptions where mode = 'live' and abandoned_at is null group by status) x
      ),
      'paying_now', (
        select pg_catalog.count(distinct user_id) from public.billing_subscriptions
        where mode = 'live' and user_id is not null and paid_until is not null and paid_until > pg_catalog.now()
      )
    ),
    'monthly', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'month', pg_catalog.to_char(m.month, 'YYYY-MM'),
        'new_accounts', m.new_accounts,
        'subscriptions_started', m.subscriptions_started,
        'cancellations', m.cancellations,
        'payments_captured', m.payments_captured,
        'payments_failed', m.payments_failed,
        'captured_paise', m.captured_paise,
        'refunded_paise', m.refunded_paise
      ) order by m.month), '[]'::jsonb)
      from monthly m
    )
  ) into result;
  return result;
end;
$function$;

-- Privileges ---------------------------------------------------------------------------------------------

revoke all on function public.fitx_admin_content_text_array(jsonb) from public, anon, authenticated;
revoke all on function public.fitx_admin_content_slug(text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_save_exercise(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_delete_exercise(uuid, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_add_exercise_media(uuid, text, text, text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_remove_exercise_media(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_set_programme_status(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_training_counts(uuid) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_save_food(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_set_food_active(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_set_food_portions(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_set_food_image(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_rename_food_category(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_food_categories(uuid) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_save_billing_plan(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_report(uuid, integer) from public, anon, authenticated;

grant execute on function public.fitx_admin_content_text_array(jsonb) to service_role;
grant execute on function public.fitx_admin_content_slug(text) to service_role;
grant execute on function public.fitx_admin_op_save_exercise(uuid, text, jsonb) to service_role;
grant execute on function public.fitx_admin_op_delete_exercise(uuid, text) to service_role;
grant execute on function public.fitx_admin_op_add_exercise_media(uuid, text, text, text, text, text, text, integer, integer) to service_role;
grant execute on function public.fitx_admin_op_remove_exercise_media(uuid, uuid) to service_role;
grant execute on function public.fitx_admin_op_set_programme_status(uuid, text, text) to service_role;
grant execute on function public.fitx_admin_op_training_counts(uuid) to service_role;
grant execute on function public.fitx_admin_op_save_food(uuid, text, jsonb) to service_role;
grant execute on function public.fitx_admin_op_set_food_active(uuid, text, boolean) to service_role;
grant execute on function public.fitx_admin_op_set_food_portions(uuid, text, jsonb) to service_role;
grant execute on function public.fitx_admin_op_set_food_image(uuid, text, text, text, text) to service_role;
grant execute on function public.fitx_admin_op_rename_food_category(uuid, text, text) to service_role;
grant execute on function public.fitx_admin_op_food_categories(uuid) to service_role;
grant execute on function public.fitx_admin_op_save_billing_plan(uuid, text, jsonb) to service_role;
grant execute on function public.fitx_admin_op_report(uuid, integer) to service_role;
