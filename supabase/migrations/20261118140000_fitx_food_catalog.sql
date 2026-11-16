-- Nutrition v2: FITX's own food catalogue and household portions. Additive.
-- Rows are reference data from licensed sources (USDA FoodData Central, public domain, to start); no user data.
-- Signed-in users can read active foods. Nobody writes through the API: rows come from the seed
-- migrations (20261118140010_* onwards) or, later, the Admin app's server-side client.

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.food_catalog (
  -- USDA rows use the FoodData Central id ("2708346"), which is also what meals.provider_id stores.
  id text primary key check (char_length(id) between 1 and 64),
  name text not null check (char_length(name) between 1 and 200),
  -- Lower-case names the food answers to exactly: FITX spellings such as "idly", "chapathi", "chana".
  -- Typing one of them can select the food without asking.
  aliases text[] not null default '{}'::text[],
  -- Lower-case words that help find the food but never select it: the source's extra descriptions
  -- (FNDDS lists "lobster" under Seafood sauce, so "lobster" must not pick the sauce).
  keywords text[] not null default '{}'::text[],
  -- Lower-case name, aliases and keywords, kept by food_catalog_before_write(); what search matches against.
  search_text text not null default '',
  category text check (category is null or char_length(category) <= 120),
  cuisine text check (cuisine is null or char_length(cuisine) <= 40),
  -- Worked out from the source's ingredient list; null when unknown.
  diet_type text check (diet_type in ('vegan', 'veg', 'egg', 'non_veg')),
  state text check (state in ('raw', 'cooked')),
  -- Values per 100 g of food as eaten.
  kcal numeric(7,2) not null check (kcal >= 0 and kcal <= 950),
  protein_g numeric(6,2) not null default 0 check (protein_g >= 0 and protein_g <= 100),
  carbs_g numeric(6,2) not null default 0 check (carbs_g >= 0 and carbs_g <= 100),
  fat_g numeric(6,2) not null default 0 check (fat_g >= 0 and fat_g <= 100),
  fiber_g numeric(6,2) check (fiber_g is null or (fiber_g >= 0 and fiber_g <= 100)),
  sugar_g numeric(6,2) check (sugar_g is null or (sugar_g >= 0 and sugar_g <= 100)),
  sodium_mg numeric(8,2) check (sodium_mg is null or (sodium_mg >= 0 and sodium_mg <= 40000)),
  -- How the values were obtained: lab_analysed (USDA Foundation), compiled (USDA SR Legacy reference values),
  -- recipe_calculated (USDA FNDDS typical recipes), label (package label), estimated (anything else).
  value_basis text not null check (value_basis in ('lab_analysed', 'compiled', 'recipe_calculated', 'label', 'estimated')),
  source text not null default 'usda_fdc' check (char_length(source) <= 40),
  source_ref text check (source_ref is null or char_length(source_ref) <= 64),
  source_data_type text check (source_data_type is null or char_length(source_data_type) <= 40),
  source_version text check (source_version is null or char_length(source_version) <= 40),
  licence text not null default 'CC0-1.0' check (char_length(licence) <= 40),
  attribution text check (attribution is null or char_length(attribution) <= 300),
  -- Images only with a licence and an attribution line.
  image_url text check (image_url is null or image_url ~ '^https://'),
  image_license text,
  image_attribution text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint food_catalog_image_credit check (image_url is null or (image_license is not null and image_attribution is not null))
);

create table if not exists public.food_portions (
  id bigint generated always as identity primary key,
  food_id text not null references public.food_catalog (id) on delete cascade,
  -- The source's own wording, such as USDA's "1 item" (idli) or "1 cup, cooked" (rice).
  label text not null check (char_length(label) between 1 and 120),
  unit text not null check (unit in ('piece', 'slice', 'serving', 'cup', 'tbsp', 'tsp', 'ml', 'l', 'floz', 'katori', 'bowl', 'plate', 'glass')),
  grams numeric(8,2) not null check (grams > 0 and grams <= 5000),
  -- The portion a bare count uses: "3 idlis" is 3 of this one.
  is_default boolean not null default false,
  -- Household measures are averages, so amounts worked out from them are shown as estimates.
  is_estimate boolean not null default true,
  source text not null default 'usda_fdc' check (char_length(source) <= 40),
  sort_order smallint not null default 0,
  unique (food_id, label)
);

-- gin_trgm_ops comes from pg_trgm, found through Supabase's default search path (public, extensions).
create index if not exists food_catalog_search_trgm_idx on public.food_catalog using gin (search_text gin_trgm_ops);
create index if not exists food_catalog_name_lower_idx on public.food_catalog (lower(name));
create index if not exists food_catalog_aliases_idx on public.food_catalog using gin (aliases);
create index if not exists food_portions_food_idx on public.food_portions (food_id, sort_order);

create or replace function public.food_catalog_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.aliases := coalesce(array(select distinct lower(trim(a)) from unnest(new.aliases) as a where trim(a) <> ''), '{}'::text[]);
  new.keywords := coalesce(array(select distinct lower(trim(k)) from unnest(new.keywords) as k where trim(k) <> ''), '{}'::text[]);
  new.search_text := lower(new.name || ' ' || array_to_string(new.aliases, ' ') || ' ' || array_to_string(new.keywords, ' '));
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists food_catalog_before_write on public.food_catalog;
create trigger food_catalog_before_write before insert or update on public.food_catalog
  for each row execute function public.food_catalog_before_write();
revoke execute on function public.food_catalog_before_write() from public, anon, authenticated;

alter table public.food_catalog enable row level security;
alter table public.food_portions enable row level security;

drop policy if exists food_catalog_read on public.food_catalog;
create policy food_catalog_read on public.food_catalog for select to authenticated using (is_active);
drop policy if exists food_portions_read on public.food_portions;
create policy food_portions_read on public.food_portions for select to authenticated
  using (exists (select 1 from public.food_catalog f where f.id = food_portions.food_id and f.is_active));

revoke all on table public.food_catalog, public.food_portions from public, anon, authenticated;
grant select on table public.food_catalog, public.food_portions to authenticated;

comment on table public.food_catalog is 'FITX food catalogue (reference data). Values per 100 g. See src/data/DATA_SOURCES.md for sources and licences.';
comment on column public.food_catalog.value_basis is 'lab_analysed: USDA Foundation. compiled: USDA SR Legacy. recipe_calculated: USDA FNDDS typical recipe. label: package label. estimated: other.';
