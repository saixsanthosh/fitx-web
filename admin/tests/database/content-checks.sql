\set ON_ERROR_STOP 1
\set QUIET 1
-- Functional checks for 20261121100036_fitx_admin_content on a throwaway database: the Workouts,
-- Nutrition, Subscriptions and Reports functions for Admin operators. Each block raises with a label when
-- an expectation fails. Names, ids and amounts are made up.

create temporary table content_ids (name text primary key, id text);
grant all on content_ids to public;

-- Operators -------------------------------------------------------------------------------------------
do $$
declare
  root_id uuid := public.fitx_admin_op_root_sign_in('test-owner');
  hash text := 'scrypt:32768:8:1:AAAAAAAAAAAAAAAAAAAAAA:' || repeat('C', 86);
begin
  insert into content_ids values
    ('root', root_id::text),
    ('editor', public.fitx_admin_op_create_operator(root_id, 'content-editor-check', 'content_editor', hash)::text),
    ('viewer', public.fitx_admin_op_create_operator(root_id, 'content-viewer-check', 'viewer', hash)::text),
    ('admin', public.fitx_admin_op_create_operator(root_id, 'content-admin-check', 'admin', hash)::text);
end $$;

-- Storage buckets ----------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'exercise-media' and public and file_size_limit = 52428800
                 and allowed_mime_types @> array['image/jpeg', 'video/mp4', 'video/webm']) then
    raise exception 'exercise-media must be public with type and size limits';
  end if;
  if not exists (select 1 from storage.buckets where id = 'food-media' and public and file_size_limit = 5242880
                 and not (allowed_mime_types && array['video/mp4', 'image/svg+xml', 'text/html'])) then
    raise exception 'food-media must be public, 5 MB, photos only';
  end if;
  if exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass and (pg_get_expr(polqual, polrelid) ilike '%food-media%'
             or pg_get_expr(polwithcheck, polrelid) ilike '%food-media%' or pg_get_expr(polwithcheck, polrelid) ilike '%exercise-media%')) then
    raise exception 'no storage policy may let members write to the Admin buckets';
  end if;
end $$;
\echo ok buckets: exercise-media and food-media are public, typed and size-limited, written only through the server

-- Every content function is service_role only with a pinned search path ------------------------------------
do $$
declare
  f record;
  n integer := 0;
begin
  for f in
    select p.oid, p.proname, p.prosecdef, p.proconfig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('fitx_admin_op_save_exercise', 'fitx_admin_op_delete_exercise', 'fitx_admin_op_add_exercise_media',
        'fitx_admin_op_remove_exercise_media', 'fitx_admin_op_set_programme_status', 'fitx_admin_op_training_counts',
        'fitx_admin_op_save_food', 'fitx_admin_op_set_food_active', 'fitx_admin_op_set_food_portions', 'fitx_admin_op_set_food_image',
        'fitx_admin_op_rename_food_category', 'fitx_admin_op_food_categories', 'fitx_admin_op_save_billing_plan', 'fitx_admin_op_report',
        'fitx_admin_content_text_array', 'fitx_admin_content_slug')
  loop
    n := n + 1;
    if has_function_privilege('anon', f.oid, 'execute') or has_function_privilege('authenticated', f.oid, 'execute') then
      raise exception '% must not be callable by anon or authenticated', f.proname;
    end if;
    if not has_function_privilege('service_role', f.oid, 'execute') then raise exception '% must be callable by service_role', f.proname; end if;
    if not coalesce(f.proconfig @> array['search_path=""'], false) then raise exception '% must pin search_path', f.proname; end if;
    if f.proname like 'fitx_admin_op\_%' and not f.prosecdef then raise exception '% must be security definer', f.proname; end if;
  end loop;
  if n <> 16 then raise exception 'expected 16 content functions, found %', n; end if;
end $$;
\echo ok content functions: service_role only, pinned search path

-- Exercises ------------------------------------------------------------------------------------------------
do $$
declare
  editor uuid := (select id::uuid from content_ids where name = 'editor');
  viewer uuid := (select id::uuid from content_ids where name = 'viewer');
  body jsonb := jsonb_build_object(
    'name', 'Check Tempo Squat', 'description', 'A slow squat.', 'primary_muscle', 'quadriceps', 'muscle_group', 'quadriceps',
    'secondary_muscles', jsonb_build_array('glutes'), 'category', 'strength', 'mechanic', 'compound', 'difficulty', 'beginner',
    'movement_pattern', 'squat', 'required_equipment', jsonb_build_array('dumbbell'), 'equipment', jsonb_build_array('dumbbell'),
    'locations', jsonb_build_array('gym', 'home'), 'instructions', jsonb_build_array('Stand tall.', '  ', 'Sit back slowly.'),
    'recommended_sets', 3, 'reps_min', 8, 'reps_max', 12, 'rest_seconds', 90, 'prescription_type', 'reps', 'attribution', 'FITX');
  new_id text;
  again text;
  row_after public.exercise_library%rowtype;
  audit record;
begin
  begin perform public.fitx_admin_op_save_exercise(viewer, null, body); raise exception 'a viewer created an exercise';
  exception when insufficient_privilege then null; end;
  new_id := public.fitx_admin_op_save_exercise(editor, null, body);
  if new_id <> 'fitx-check-tempo-squat' then raise exception 'new exercise id: %', new_id; end if;
  select * into row_after from public.exercise_library where id = new_id;
  if row_after.is_active or row_after.catalog_version <> 1 or row_after.instructions <> array['Stand tall.', 'Sit back slowly.'] then
    raise exception 'a new exercise starts hidden with clean steps: %', row_to_json(row_after);
  end if;
  begin perform public.fitx_admin_op_save_exercise(editor, null, body || '{"name":"check tempo squat"}'); raise exception 'a duplicate name was accepted';
  exception when unique_violation then null; end;
  begin perform public.fitx_admin_op_save_exercise(editor, null, body || '{"name":"Other","required_equipment":["laser"]}'); raise exception 'unknown equipment accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_save_exercise(editor, null, body || '{"name":"Other","reps_min":12,"reps_max":8}'); raise exception 'reps out of order accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_save_exercise(editor, null, body || '{"name":"Other","prescription_type":"time"}'); raise exception 'a timed exercise without duration accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_save_exercise(editor, null, body || '{"name":"Other","muscle_group":"spleen"}'); raise exception 'an unknown muscle group accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_save_exercise(editor, null, body || '{"name":"Other","recommended_sets":"three"}'); raise exception 'text sets accepted';
  exception when sqlstate '22023' then null; end;

  again := public.fitx_admin_op_save_exercise(editor, new_id, body || '{"reps_max":15,"description":"A slow, controlled squat."}');
  select * into audit from public.fitx_admin_audit_logs where action = 'exercise_updated' and resource_id = new_id order by id desc limit 1;
  if again <> new_id or audit.details -> 'changed' <> '["description","prescription"]'::jsonb or audit.actor_operator_id <> editor then
    raise exception 'exercise_updated audit: %', row_to_json(audit);
  end if;
  perform public.fitx_admin_op_save_exercise(editor, new_id, body || '{"reps_max":15,"description":"A slow, controlled squat."}');
  if (select count(*) from public.fitx_admin_audit_logs where action = 'exercise_updated' and resource_id = new_id) <> 1 then
    raise exception 'saving without changes must not write an audit row';
  end if;
  begin perform public.fitx_admin_op_save_exercise(editor, 'no-such-exercise', body); raise exception 'a missing exercise was updated';
  exception when no_data_found then null; end;
  insert into content_ids values ('exercise', new_id);
end $$;
\echo ok exercises: created hidden with a fitx- id, validated, edited with the changed fields audited

do $$
declare
  editor uuid := (select id::uuid from content_ids where name = 'editor');
  ex text := (select id from content_ids where name = 'exercise');
  m1 uuid;
  m2 uuid;
  path text;
  paths text[];
begin
  m1 := public.fitx_admin_op_add_exercise_media(editor, ex, 'still', 'admin/' || ex || '/still-abc123.jpg', 'Bottom position', 'FITX', 'FITX own work', 1200, 900);
  m2 := public.fitx_admin_op_add_exercise_media(editor, ex, 'video_loop', 'admin/' || ex || '/video-def456.mp4', 'Full rep', 'FITX', 'FITX own work');
  if (select position from public.exercise_media where id = m1) <> 0 or (select mirrored_at from public.exercise_media where id = m2) is null
     or (select source_url from public.exercise_media where id = m2) is not null then
    raise exception 'uploaded media is recorded as a self-hosted copy';
  end if;
  begin perform public.fitx_admin_op_add_exercise_media(editor, ex, 'still', 'admin/bench_press/still-x.jpg', '', 'FITX', 'FITX own work'); raise exception 'another exercise''s folder accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_add_exercise_media(editor, ex, 'still', 'admin/' || ex || '/../still-x.jpg', '', 'FITX', 'FITX own work'); raise exception 'a path escape accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_add_exercise_media(editor, ex, 'still', 'admin/' || ex || '/still-x.svg', '', 'FITX', 'FITX own work'); raise exception 'an svg accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_add_exercise_media(editor, ex, 'still', 'admin/' || ex || '/still-y.jpg', '', ' ', 'FITX own work'); raise exception 'no credit accepted';
  exception when sqlstate '22023' then null; end;
  path := public.fitx_admin_op_remove_exercise_media(editor, m1);
  if path <> 'admin/' || ex || '/still-abc123.jpg' then raise exception 'removing an upload returns its path: %', path; end if;
  if public.fitx_admin_op_remove_exercise_media(editor, (select id from public.exercise_media where storage_path like 'free-exercise-db/%' limit 1)) is not null then
    raise exception 'a catalogue photo keeps its file';
  end if;

  begin perform public.fitx_admin_op_delete_exercise(editor, 'bench_press'); raise exception 'a catalogue exercise was deleted';
  exception when sqlstate 'FXC02' then null; end;
  insert into auth.users (id, email, email_confirmed_at, created_at) values ('00000000-0000-4000-8000-0000000003c1', 'content-member@example.com', now(), now());
  insert into public.exercise_favorites (user_id, exercise_id) values ('00000000-0000-4000-8000-0000000003c1', ex);
  begin perform public.fitx_admin_op_delete_exercise(editor, ex); raise exception 'an exercise in use was deleted';
  exception when sqlstate 'FXC01' then null; end;
  delete from public.exercise_favorites where user_id = '00000000-0000-4000-8000-0000000003c1';
  paths := public.fitx_admin_op_delete_exercise(editor, ex);
  if paths <> array['admin/' || ex || '/video-def456.mp4'] or exists (select 1 from public.exercise_library where id = ex) then
    raise exception 'deleting returns the uploaded files: %', paths;
  end if;
  if (select details ->> 'media_removed' from public.fitx_admin_audit_logs where action = 'exercise_deleted' and resource_id = ex) <> '1' then
    raise exception 'exercise_deleted audit';
  end if;
end $$;
\echo ok exercise media: own folder, photo and video types, credits required; delete only Admin-made, unused exercises

do $$
declare
  editor uuid := (select id::uuid from content_ids where name = 'editor');
  viewer uuid := (select id::uuid from content_ids where name = 'viewer');
  counts jsonb;
begin
  perform public.fitx_admin_op_set_programme_status(editor, 'ppl-3', 'draft');
  if (select status from public.training_programmes where id = 'ppl-3') <> 'draft' then raise exception 'programme to draft'; end if;
  perform public.fitx_admin_op_set_programme_status(editor, 'ppl-3', 'published');
  if (select count(*) from public.fitx_admin_audit_logs where action = 'programme_status_updated' and resource_id = 'ppl-3') <> 2 then raise exception 'programme audit'; end if;
  begin perform public.fitx_admin_op_set_programme_status(editor, 'ppl-3', 'archived'); raise exception 'an unknown status accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_training_counts(viewer); raise exception 'a viewer read the training counts';
  exception when insufficient_privilege then null; end;
  counts := public.fitx_admin_op_training_counts(editor);
  if (counts #>> '{exercises,total}')::int <> (select count(*) from public.exercise_library)
     or (counts #>> '{muscle_groups,chest,total}')::int <> (select count(*) from public.exercise_library where muscle_group = 'chest')
     or (counts #>> '{equipment,none,total}')::int <> (select count(*) from public.exercise_library where cardinality(required_equipment) = 0) then
    raise exception 'training counts: %', counts;
  end if;
end $$;
\echo ok programmes publish and go back to draft with an audit row; training counts match the catalogue

-- Foods ------------------------------------------------------------------------------------------------------
do $$
declare
  editor uuid := (select id::uuid from content_ids where name = 'editor');
  viewer uuid := (select id::uuid from content_ids where name = 'viewer');
  body jsonb := jsonb_build_object('name', 'Check Ragi Dosa', 'aliases', jsonb_build_array('Ragi Dosa', 'nachni dosa'), 'keywords', '[]'::jsonb,
    'category', 'Check breakfasts', 'cuisine', 'indian', 'diet_type', 'veg', 'state', 'cooked', 'kcal', 180, 'protein_g', 4.5,
    'carbs_g', 30, 'fat_g', 4.2, 'fiber_g', 3.1, 'value_basis', 'estimated', 'attribution', 'FITX kitchen test');
  food text;
  renamed integer;
  url text;
  previous text;
begin
  begin perform public.fitx_admin_op_save_food(viewer, null, body); raise exception 'a viewer created a food';
  exception when insufficient_privilege then null; end;
  food := public.fitx_admin_op_save_food(editor, null, body);
  if food <> 'fitx-check-ragi-dosa' or (select is_active or source <> 'fitx_admin' or aliases <> array['ragi dosa', 'nachni dosa'] from public.food_catalog where id = food) then
    raise exception 'new food: %', (select row_to_json(f) from public.food_catalog f where id = food);
  end if;
  begin perform public.fitx_admin_op_save_food(editor, null, body || '{"protein_g":60,"carbs_g":40,"fat_g":10}'); raise exception 'macros over 100 g accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_save_food(editor, null, body || '{"kcal":1200}'); raise exception 'impossible calories accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_save_food(editor, null, body || '{"value_basis":"guess"}'); raise exception 'an unknown value basis accepted';
  exception when sqlstate '22023' then null; end;
  perform public.fitx_admin_op_save_food(editor, food, body || '{"kcal":175}');
  if (select details -> 'changed' from public.fitx_admin_audit_logs where action = 'food_updated' and resource_id = food) <> '["macros"]'::jsonb then
    raise exception 'food_updated audit';
  end if;

  perform public.fitx_admin_op_set_food_active(editor, food, true);
  if not (select is_active from public.food_catalog where id = food) then raise exception 'food shown'; end if;

  if public.fitx_admin_op_set_food_portions(editor, food, '[{"label":"1 dosa","unit":"piece","grams":"85","is_default":true},{"label":"2 dosas","unit":"piece","grams":170}]') <> 2 then
    raise exception 'portions saved';
  end if;
  begin perform public.fitx_admin_op_set_food_portions(editor, food, '[{"label":"a","unit":"piece","grams":10,"is_default":true},{"label":"b","unit":"piece","grams":20,"is_default":true}]'); raise exception 'two defaults accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_set_food_portions(editor, food, '[{"label":"a","unit":"bucket","grams":10}]'); raise exception 'an unknown unit accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_set_food_portions(editor, food, '[{"label":"a","unit":"piece","grams":0}]'); raise exception 'zero grams accepted';
  exception when sqlstate '22023' then null; end;
  perform public.fitx_admin_op_set_food_portions(editor, food, '[{"label":"1 dosa","unit":"piece","grams":90,"is_default":true}]');
  if (select count(*) from public.food_portions where food_id = food) <> 1 or (select grams from public.food_portions where food_id = food) <> 90 then
    raise exception 'portions are replaced';
  end if;

  url := 'https://example.supabase.co/storage/v1/object/public/food-media/admin/' || food || '/photo-abc123.webp';
  previous := public.fitx_admin_op_set_food_image(editor, food, url, 'FITX own work', 'Photo: FITX');
  if previous is not null or (select image_url from public.food_catalog where id = food) <> url then raise exception 'food image set'; end if;
  begin perform public.fitx_admin_op_set_food_image(editor, food, 'https://evil.example/x.jpg', 'x', 'y'); raise exception 'an outside image accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_set_food_image(editor, food, 'https://example.supabase.co/storage/v1/object/public/food-media/admin/2706538/p.jpg', 'x', 'y'); raise exception 'another food''s folder accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_set_food_image(editor, food, url, '', 'y'); raise exception 'a photo without a licence accepted';
  exception when sqlstate '22023' then null; end;
  previous := public.fitx_admin_op_set_food_image(editor, food, null, null, null);
  if previous <> url or (select image_url is not null or image_license is not null from public.food_catalog where id = food) then
    raise exception 'food image cleared';
  end if;

  renamed := public.fitx_admin_op_rename_food_category(editor, 'Check breakfasts', 'Check tiffin');
  if renamed <> 1 or (select category from public.food_catalog where id = food) <> 'Check tiffin' then raise exception 'category renamed'; end if;
  if not exists (select 1 from public.fitx_admin_op_food_categories(editor) c where c.category = 'Check tiffin' and c.foods = 1 and c.active = 1) then
    raise exception 'food categories list';
  end if;
  begin perform public.fitx_admin_op_rename_food_category(editor, 'No such category', 'x'); raise exception 'renaming nothing passed';
  exception when no_data_found then null; end;
  begin perform public.fitx_admin_op_food_categories(viewer); raise exception 'a viewer read food categories';
  exception when insufficient_privilege then null; end;
end $$;
\echo ok foods: created hidden, values per 100 g checked, portions replaced, photos only from the food-media upload folder, categories renamed

-- A USDA food whose values an operator changes stops naming USDA: its numbers are FITX's own now.
do $$
declare
  editor uuid := (select id::uuid from content_ids where name = 'editor');
  usda public.food_catalog%rowtype;
  body jsonb;
  after_row public.food_catalog%rowtype;
begin
  select * into usda from public.food_catalog
  where source = 'usda_fdc' and value_basis = 'lab_analysed' and source_ref is not null and source_data_type is not null
  order by id limit 1;
  if not found then raise exception 'no seeded USDA Foundation food to edit'; end if;
  body := jsonb_build_object('name', usda.name, 'aliases', to_jsonb(usda.aliases), 'keywords', to_jsonb(usda.keywords),
    'category', usda.category, 'cuisine', usda.cuisine, 'diet_type', usda.diet_type, 'state', usda.state,
    'kcal', usda.kcal, 'protein_g', usda.protein_g, 'carbs_g', usda.carbs_g, 'fat_g', usda.fat_g, 'fiber_g', usda.fiber_g,
    'sugar_g', usda.sugar_g, 'sodium_mg', usda.sodium_mg, 'value_basis', usda.value_basis, 'attribution', usda.attribution);

  perform public.fitx_admin_op_save_food(editor, usda.id, body || jsonb_build_object('category', 'Check USDA rename'));
  select * into after_row from public.food_catalog where id = usda.id;
  if after_row.source <> 'usda_fdc' or after_row.source_ref is distinct from usda.source_ref
     or after_row.source_data_type is distinct from usda.source_data_type or after_row.licence is distinct from usda.licence then
    raise exception 'a change that keeps the values kept the USDA source: %', row_to_json(after_row);
  end if;

  begin
    perform public.fitx_admin_op_save_food(editor, usda.id, body || jsonb_build_object('protein_g', usda.protein_g + 1));
    raise exception 'changed values kept the lab analysed basis';
  exception when sqlstate '22023' then null; end;
  if (select protein_g from public.food_catalog where id = usda.id) <> usda.protein_g then raise exception 'a refused change was saved'; end if;

  perform public.fitx_admin_op_save_food(editor, usda.id, body || jsonb_build_object('protein_g', usda.protein_g + 1, 'value_basis', 'estimated'));
  select * into after_row from public.food_catalog where id = usda.id;
  if after_row.source <> 'fitx_admin' or after_row.source_ref is not null or after_row.source_data_type is not null
     or after_row.source_version is not null or after_row.licence <> 'FITX' or after_row.value_basis <> 'estimated'
     or after_row.protein_g <> usda.protein_g + 1 then
    raise exception 'changed values still name the USDA source: %', row_to_json(after_row);
  end if;
  if not (select details -> 'changed' ? 'source' from public.fitx_admin_audit_logs
          where action = 'food_updated' and resource_id = usda.id order by id desc limit 1) then
    raise exception 'the audit row does not say the source changed';
  end if;
  update public.food_catalog set category = usda.category, protein_g = usda.protein_g, value_basis = usda.value_basis, source = usda.source,
    source_ref = usda.source_ref, source_data_type = usda.source_data_type, source_version = usda.source_version, licence = usda.licence
  where id = usda.id;
end $$;
\echo ok a USDA food keeps its source until its values change, then becomes a FITX food that is never lab analysed

-- Subscription plans -----------------------------------------------------------------------------------------
do $$
declare
  root_id uuid := (select id::uuid from content_ids where name = 'root');
  admin_id uuid := (select id::uuid from content_ids where name = 'admin');
  plan jsonb := '{"name":"Check Monthly","description":"Everything","features":["Coach","Programmes"],"amount_paise":19900,"billing_period":"monthly","billing_interval":1,"razorpay_plan_id_test":"plan_CheckTest1","is_active":false}';
begin
  begin perform public.fitx_admin_op_save_billing_plan(admin_id, 'check-monthly', plan); raise exception 'an admin (no billing.manage) created a plan';
  exception when insufficient_privilege then null; end;
  perform public.fitx_admin_op_save_billing_plan(root_id, 'Check-Monthly', plan);
  if not exists (select 1 from public.billing_plans where code = 'check-monthly' and amount_paise = 19900 and not is_active and features = array['Coach', 'Programmes']) then
    raise exception 'plan created';
  end if;
  begin perform public.fitx_admin_op_save_billing_plan(root_id, 'check-monthly', plan || '{"amount_paise":29900}'); raise exception 'a price change accepted';
  exception when sqlstate 'FXC04' then null; end;
  begin perform public.fitx_admin_op_save_billing_plan(root_id, 'check-monthly', plan || '{"razorpay_plan_id_test":"plan_Other"}'); raise exception 'a plan id change accepted';
  exception when sqlstate 'FXC04' then null; end;
  perform public.fitx_admin_op_save_billing_plan(root_id, 'check-monthly', plan || '{"name":"Check Monthly Plus","is_active":true,"razorpay_plan_id_live":"plan_CheckLive1"}');
  if not exists (select 1 from public.billing_plans where code = 'check-monthly' and name = 'Check Monthly Plus' and is_active and razorpay_plan_id_live = 'plan_CheckLive1') then
    raise exception 'plan edited';
  end if;
  if (select details -> 'changed' from public.fitx_admin_audit_logs where action = 'billing_plan_updated' and resource_id = 'check-monthly') <> '["name","is_active","razorpay_plan_id_live"]'::jsonb then
    raise exception 'billing_plan_updated audit';
  end if;
  begin perform public.fitx_admin_op_save_billing_plan(root_id, 'check-yearly', plan || '{"billing_period":"yearly","billing_interval":2,"razorpay_plan_id_test":null}'); raise exception 'a two-year interval accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_save_billing_plan(root_id, 'check-copy', plan); raise exception 'a reused Razorpay plan id accepted';
  exception when unique_violation then null; end;
end $$;
\echo ok plans: super-admins create and edit them; prices and Razorpay plan ids never change once set

-- Reports ------------------------------------------------------------------------------------------------------
do $$
declare
  viewer uuid := (select id::uuid from content_ids where name = 'viewer');
  editor uuid := (select id::uuid from content_ids where name = 'editor');
  member uuid := '00000000-0000-4000-8000-0000000003c2';
  before jsonb;
  after jsonb;
  today_before jsonb;
  today_after jsonb;
  session_id uuid;
  plan_id uuid := (select id from public.billing_plans where code = 'check-monthly');
  sub_id uuid;
  month_before jsonb;
  month_after jsonb;
begin
  begin perform public.fitx_admin_op_report(editor, 30); raise exception 'a content editor read reports';
  exception when insufficient_privilege then null; end;
  before := public.fitx_admin_op_report(viewer, 30);
  if jsonb_array_length(before -> 'daily') <> 30 or (before ->> 'days')::int <> 30 or jsonb_array_length(before -> 'monthly') <> 12 then
    raise exception 'report shape: % days, % months', jsonb_array_length(before -> 'daily'), jsonb_array_length(before -> 'monthly');
  end if;
  if (public.fitx_admin_op_report(viewer, 9999) ->> 'days')::int <> 365 or (public.fitx_admin_op_report(viewer, 1) ->> 'days')::int <> 7 then
    raise exception 'report range is held to 7 to 365 days';
  end if;

  insert into auth.users (id, email, email_confirmed_at, created_at) values (member, 'report-member@example.com', now(), now());
  insert into public.workout_sessions (user_id, name, status, started_at, completed_at, duration_seconds)
  values (member, 'Check session', 'completed', now(), now(), 1800) returning id into session_id;
  insert into public.workout_session_exercises (user_id, session_id, exercise_id, exercise_name, sort_order)
  values (member, session_id, 'bench_press', 'My own words for it', 0);
  insert into public.meals (user_id, meal, food_name, source, barcode) values (member, 'Breakfast', 'Check idli', 'FITX catalogue', '8901234567890');
  insert into public.water_logs (user_id, amount_ml) values (member, 250);
  insert into public.billing_subscriptions (user_id, plan_id, mode, provider_subscription_id, provider_plan_id, status, paid_until)
  values (member, plan_id, 'live', 'sub_CheckReport1', 'plan_CheckLive1', 'active', now() + interval '20 days') returning id into sub_id;
  insert into public.billing_payments (user_id, subscription_id, mode, provider_payment_id, amount_paise, currency, status, captured_at)
  values (member, sub_id, 'live', 'pay_CheckReport1', 19900, 'INR', 'captured', now()),
         (member, sub_id, 'test', 'pay_CheckReport2', 19900, 'INR', 'captured', now());

  after := public.fitx_admin_op_report(viewer, 30);
  today_before := before -> 'daily' -> 29;
  today_after := after -> 'daily' -> 29;
  month_before := before -> 'monthly' -> 11;
  month_after := after -> 'monthly' -> 11;
  if (after ->> 'accounts_total')::int - (before ->> 'accounts_total')::int <> 1
     or (today_after ->> 'new_accounts')::int - (today_before ->> 'new_accounts')::int <> 1
     or (today_after ->> 'dau')::int - (today_before ->> 'dau')::int <> 1
     or (today_after ->> 'mau')::int - (today_before ->> 'mau')::int <> 1
     or (today_after ->> 'workouts_completed')::int - (today_before ->> 'workouts_completed')::int <> 1
     or (today_after ->> 'meals_logged')::int - (today_before ->> 'meals_logged')::int <> 1
     or (today_after ->> 'water_entries')::int - (today_before ->> 'water_entries')::int <> 1 then
    raise exception 'daily report: before % after %', today_before, today_after;
  end if;
  if (after #>> '{nutrition,barcode_meals}')::int - (before #>> '{nutrition,barcode_meals}')::int <> 1
     or (after #>> '{workouts,completed}')::int - (before #>> '{workouts,completed}')::int <> 1 then
    raise exception 'report totals';
  end if;
  if not exists (select 1 from jsonb_array_elements(after #> '{workouts,top_exercises}') t where t ->> 'exercise_id' = 'bench_press' and t ->> 'name' = 'Barbell Bench Press') then
    raise exception 'top exercises use catalogue names, never what members typed';
  end if;
  if after::text like '%My own words%' or after::text like '%report-member@%' or after::text like '%Check idli%' then
    raise exception 'the report carries member text';
  end if;
  if (month_after ->> 'captured_paise')::int - (month_before ->> 'captured_paise')::int <> 19900
     or (month_after ->> 'subscriptions_started')::int - (month_before ->> 'subscriptions_started')::int <> 1
     or (after #>> '{subscriptions,paying_now}')::int - (before #>> '{subscriptions,paying_now}')::int <> 1 then
    raise exception 'revenue counts live mode only: before % after %', month_before, month_after;
  end if;
end $$;
\echo ok reports: role-checked, 7 to 365 days, growth, active users, workouts, nutrition and live revenue are counts with no member text

-- A member who only records walks, runs or rides counts as active in Reports and on the Overview.
do $$
declare
  viewer uuid := (select id::uuid from content_ids where name = 'viewer');
  walker uuid := '00000000-0000-4000-8000-0000000003c3';
  report_before jsonb;
  report_after jsonb;
  metrics_before jsonb;
  metrics_after jsonb;
  trend_before integer;
  trend_after integer;
begin
  insert into auth.users (id, email, email_confirmed_at, created_at) values (walker, 'report-walker@example.com', now(), now() - interval '40 days');
  report_before := public.fitx_admin_op_report(viewer, 30);
  metrics_before := public.fitx_admin_metrics();
  select active_accounts into trend_before from public.fitx_admin_daily_trends(7) order by day desc limit 1;
  insert into public.activities (user_id, client_id, sport, title, started_at, ended_at, elapsed_seconds, moving_seconds, distance_m)
  values (walker, gen_random_uuid(), 'walk', 'Check walk', now() - interval '30 minutes', now(), 1800, 1700, 2100);
  report_after := public.fitx_admin_op_report(viewer, 30);
  metrics_after := public.fitx_admin_metrics();
  select active_accounts into trend_after from public.fitx_admin_daily_trends(7) order by day desc limit 1;
  if (report_after #>> '{daily,29,dau}')::int - (report_before #>> '{daily,29,dau}')::int <> 1
     or (report_after #>> '{daily,29,mau}')::int - (report_before #>> '{daily,29,mau}')::int <> 1 then
    raise exception 'reports leave out activities: before % after %', report_before -> 'daily' -> 29, report_after -> 'daily' -> 29;
  end if;
  if (metrics_after ->> 'active_24h')::int - (metrics_before ->> 'active_24h')::int <> 1
     or (metrics_after ->> 'active_30d')::int - (metrics_before ->> 'active_30d')::int <> 1
     or trend_after - trend_before <> 1 then
    raise exception 'overview leaves out activities: % % to % %', metrics_before ->> 'active_24h', trend_before, metrics_after ->> 'active_24h', trend_after;
  end if;
end $$;
\echo ok a walk, run or ride makes a member active in Reports and the Overview counts

do $$
begin
  if exists (select 1 from public.fitx_admin_audit_logs where (action like 'exercise_%' or action like 'food_%' or action like 'billing_plan_%' or action like 'programme_%')
             and (details::text ilike '%ragi%' or details::text ilike '%squat%')) then
    raise exception 'content audit rows carry names or text';
  end if;
end $$;
\echo ok content audit rows hold codes and counts only

-- The runbook's Check query for 20261121100036 gives what it states (expect 16, 2).
do $$
declare
  functions integer;
  buckets integer;
begin
  select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('fitx_admin_op_save_exercise',
            'fitx_admin_op_delete_exercise', 'fitx_admin_op_add_exercise_media', 'fitx_admin_op_remove_exercise_media',
            'fitx_admin_op_set_programme_status', 'fitx_admin_op_training_counts', 'fitx_admin_op_save_food', 'fitx_admin_op_set_food_active',
            'fitx_admin_op_set_food_portions', 'fitx_admin_op_set_food_image', 'fitx_admin_op_rename_food_category',
            'fitx_admin_op_food_categories', 'fitx_admin_op_save_billing_plan', 'fitx_admin_op_report', 'fitx_admin_content_text_array',
            'fitx_admin_content_slug')),
         (select count(*) from storage.buckets where id in ('exercise-media', 'food-media') and public and file_size_limit is not null)
  into functions, buckets;
  if functions <> 16 or buckets <> 2 then raise exception 'runbook check: % functions, % buckets', functions, buckets; end if;
end $$;
\echo ok the runbook check query gives 16, 2

-- The runbook's Undo SQL runs cleanly and leaves the catalogue and the exercise-media bucket as before
-- (tried inside a transaction that is rolled back).
begin;
drop function if exists public.fitx_admin_op_report(uuid, integer);
drop function if exists public.fitx_admin_op_save_billing_plan(uuid, text, jsonb);
drop function if exists public.fitx_admin_op_food_categories(uuid);
drop function if exists public.fitx_admin_op_rename_food_category(uuid, text, text);
drop function if exists public.fitx_admin_op_set_food_image(uuid, text, text, text, text);
drop function if exists public.fitx_admin_op_set_food_portions(uuid, text, jsonb);
drop function if exists public.fitx_admin_op_set_food_active(uuid, text, boolean);
drop function if exists public.fitx_admin_op_save_food(uuid, text, jsonb);
drop function if exists public.fitx_admin_op_training_counts(uuid);
drop function if exists public.fitx_admin_op_set_programme_status(uuid, text, text);
drop function if exists public.fitx_admin_op_remove_exercise_media(uuid, uuid);
drop function if exists public.fitx_admin_op_add_exercise_media(uuid, text, text, text, text, text, text, integer, integer);
drop function if exists public.fitx_admin_op_delete_exercise(uuid, text);
drop function if exists public.fitx_admin_op_save_exercise(uuid, text, jsonb);
drop function if exists public.fitx_admin_content_slug(text);
drop function if exists public.fitx_admin_content_text_array(jsonb);
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'exercise-media';
do $$
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'fitx_admin_content\_%' or proname in ('fitx_admin_op_report', 'fitx_admin_op_save_food'))) then
    raise exception 'undo left content functions behind';
  end if;
  if not exists (select 1 from pg_proc where proname = 'fitx_admin_op_set_exercise_active') then raise exception 'undo removed an admin-v2 function'; end if;
  if (select file_size_limit from storage.buckets where id = 'exercise-media') is not null then raise exception 'undo keeps the bucket limits'; end if;
end $$;
rollback;
\echo ok the runbook undo drops only the content functions and the bucket limits
\echo ALL ADMIN CONTENT DATABASE CHECKS PASSED
