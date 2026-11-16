-- Food search for signed-in users (Nutrition v2). Needs 20261118140000 and 20261118140001.
--
-- Returns candidates, not a final order: catalogue foods and the caller's own custom foods whose text contains
-- every typed word stem, each with how often the caller logged it in the last 60 days. The app ranks them with
-- the same rules it uses offline (src/lib/domain/food-query.ts: exact name or alias first, then prefix, then
-- partial words; forms the search did not name ranked down; your own and recent foods boosted), and selects a
-- food for the user only when its whole name or alias is what was typed.
--
-- When nothing contains every word, it returns up to 10 close spellings instead (fuzzy = true), so a typo such
-- as "idlly" still finds Idli; the app shows those as suggestions and never selects one by itself.
--
-- Security invoker: row-level security applies, so only active catalogue foods and the caller's own custom foods
-- and meals are read.
create or replace function public.search_foods(phrase text, stems text[], max_results integer default 120)
returns table (
  kind text,
  id text,
  name text,
  brand text,
  aliases text[],
  keywords text[],
  category text,
  cuisine text,
  diet_type text,
  state text,
  kcal numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  fiber_g numeric,
  sugar_g numeric,
  sodium_mg numeric,
  value_basis text,
  source_data_type text,
  image_url text,
  image_attribution text,
  barcode text,
  origin text,
  serving_size text,
  serving_grams numeric,
  portions jsonb,
  recent_count integer,
  fuzzy boolean
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  terms text[];
  whole text := lower(trim(coalesce(phrase, '')));
  cap integer := greatest(1, least(coalesce(max_results, 120), 200));
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  -- Keep the typed order: the first stem is the food's head word ("chicken biryani": chicken).
  select coalesce(array_agg(t order by ord), '{}'::text[]) into terms
  from (select lower(trim(s)) as t, ord from unnest(coalesce(stems, '{}'::text[])) with ordinality as u(s, ord)) as cleaned
  where char_length(t) between 1 and 40;
  if cardinality(terms) = 0 or cardinality(terms) > 8 or char_length(whole) > 100 then
    return;
  end if;

  return query
  with recent as (
    select m.source as src, m.provider_id as ref, count(*)::integer as n
    from public.meals m
    where m.user_id = uid and m.provider_id is not null and m.created_at > now() - interval '60 days'
    group by m.source, m.provider_id
  ),
  catalog_hits as (
    select f.*
    from public.food_catalog f
    where f.is_active
      and not exists (select 1 from unnest(terms) as w where position(w in f.search_text) = 0)
    order by (lower(f.name) = whole or whole = any (f.aliases)) desc,
             (position(terms[1] in f.search_text) = 1) desc,
             char_length(f.name),
             f.id
    limit cap
  ),
  custom_hits as (
    select cf.*
    from public.custom_foods cf
    where cf.user_id = uid
      and cf.archived_at is null
      and not exists (select 1 from unnest(terms) as w where position(w in lower(cf.name || ' ' || coalesce(cf.brand, ''))) = 0)
    order by (lower(cf.name) = whole) desc, char_length(cf.name), cf.id
    limit 50
  )
  select 'catalog'::text, c.id, c.name, null::text, c.aliases, c.keywords, c.category, c.cuisine, c.diet_type, c.state,
         c.kcal, c.protein_g, c.carbs_g, c.fat_g, c.fiber_g, c.sugar_g, c.sodium_mg,
         c.value_basis, c.source_data_type, c.image_url, c.image_attribution,
         null::text, null::text, null::text, null::numeric,
         coalesce((select jsonb_agg(jsonb_build_object('label', p.label, 'unit', p.unit, 'grams', p.grams,
                                                      'isDefault', p.is_default, 'estimate', p.is_estimate)
                                    order by p.sort_order, p.grams)
                   from public.food_portions p where p.food_id = c.id), '[]'::jsonb),
         coalesce(r.n, 0), false
  from catalog_hits c
  left join recent r on r.src = 'USDA FoodData Central' and r.ref = c.id
  union all
  select 'custom'::text, cf.id::text, cf.name, cf.brand, '{}'::text[], '{}'::text[], null::text, null::text, null::text, null::text,
         cf.calories_per_100g, cf.protein_per_100g, cf.carbs_per_100g, cf.fat_per_100g, null::numeric, null::numeric, null::numeric,
         cf.value_basis, null::text, cf.image_url, cf.image_attribution,
         cf.barcode, cf.origin, cf.serving_size, cf.serving_grams,
         '[]'::jsonb, coalesce(r.n, 0), false
  from custom_hits cf
  left join recent r on r.src = 'FITX custom food' and r.ref = cf.id::text;

  if not found and char_length(whole) >= 3 then
    return query
    select 'catalog'::text, f.id, f.name, null::text, f.aliases, f.keywords, f.category, f.cuisine, f.diet_type, f.state,
           f.kcal, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g, f.sugar_g, f.sodium_mg,
           f.value_basis, f.source_data_type, f.image_url, f.image_attribution,
           null::text, null::text, null::text, null::numeric,
           coalesce((select jsonb_agg(jsonb_build_object('label', p.label, 'unit', p.unit, 'grams', p.grams,
                                                        'isDefault', p.is_default, 'estimate', p.is_estimate)
                                      order by p.sort_order, p.grams)
                     from public.food_portions p where p.food_id = f.id), '[]'::jsonb),
           0, true
    from public.food_catalog f
    where f.is_active and word_similarity(whole, f.search_text) >= 0.45
    order by word_similarity(whole, f.search_text) desc, char_length(f.name), f.id
    limit 10;
  end if;
end $$;

revoke execute on function public.search_foods(text, text[], integer) from public, anon;
grant execute on function public.search_foods(text, text[], integer) to authenticated;
