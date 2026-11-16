-- Nutrition v2 user data: custom foods you can manage, saved meals and daily routines, and editable targets.
-- Additive. Every table is owner-only under RLS, like custom_foods_owner. Until this is applied the app keeps
-- working without these features and says they need the database update.

-- Custom foods: a barcode to find the product again, an image, where the food came from and how its values
-- were obtained, and archiving instead of losing it.
alter table public.custom_foods
  add column if not exists barcode text check (barcode is null or barcode ~ '^[0-9]{8,14}$'),
  -- user: typed in. barcode: saved from a scanned package. ai_coach: added by the AI coach's "Add to My Food Plan".
  add column if not exists origin text not null default 'user' check (origin in ('user', 'barcode', 'ai_coach')),
  add column if not exists value_basis text not null default 'user_entered'
    check (value_basis in ('user_entered', 'label', 'ai_suggested', 'lab_analysed', 'compiled', 'recipe_calculated', 'estimated')),
  -- A photo in the private fitx-user-media bucket, under the owner's folder: "<uid>/foods/<file>".
  add column if not exists image_path text check (image_path is null or char_length(image_path) <= 300),
  -- A licensed third-party image (an Open Food Facts product photo) and its credit line.
  add column if not exists image_url text check (image_url is null or image_url ~ '^https://'),
  add column if not exists image_attribution text check (image_attribution is null or char_length(image_attribution) <= 300),
  -- What it was copied from, such as a catalogue id or an Open Food Facts barcode.
  add column if not exists source_ref text check (source_ref is null or char_length(source_ref) <= 64),
  add column if not exists archived_at timestamptz;

create unique index if not exists custom_foods_user_barcode_idx on public.custom_foods (user_id, barcode)
  where barcode is not null and archived_at is null;

drop trigger if exists custom_foods_touch_updated_at on public.custom_foods;
create trigger custom_foods_touch_updated_at before update on public.custom_foods
  for each row execute function public.touch_updated_at();

-- Logged entries can now be edited, so keep meals.updated_at current too.
drop trigger if exists meals_touch_updated_at on public.meals;
create trigger meals_touch_updated_at before update on public.meals
  for each row execute function public.touch_updated_at();

-- Saved meals ("Save this meal": one meal's foods) and daily routines ("Save today": a whole day), applied by
-- copying their items into meals for a chosen date. Items keep the logged amounts and per-100 g snapshot.
create table if not exists public.meal_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('meal', 'day')),
  meal_slot text check (meal_slot in ('Breakfast', 'Lunch', 'Dinner', 'Snack')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index if not exists meal_templates_user_idx on public.meal_templates (user_id, kind, name);

create table if not exists public.meal_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  meal_slot text not null check (meal_slot in ('Breakfast', 'Lunch', 'Dinner', 'Snack')),
  food_name text not null check (char_length(food_name) between 1 and 200),
  brand text check (brand is null or char_length(brand) <= 160),
  source text not null default 'manual' check (char_length(source) <= 80),
  provider_id text check (provider_id is null or char_length(provider_id) <= 64),
  serving_size text check (serving_size is null or char_length(serving_size) <= 160),
  quantity_grams numeric(9,2) check (quantity_grams is null or (quantity_grams > 0 and quantity_grams <= 5000)),
  calories numeric(9,2) not null default 0 check (calories >= 0),
  protein numeric(8,2) not null default 0 check (protein >= 0),
  carbs numeric(8,2) not null default 0 check (carbs >= 0),
  fat numeric(8,2) not null default 0 check (fat >= 0),
  nutrition_snapshot jsonb not null default '{}'::jsonb,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  foreign key (template_id, user_id) references public.meal_templates (id, user_id) on delete cascade
);
create index if not exists meal_template_items_template_idx on public.meal_template_items (template_id, sort_order);
create index if not exists meal_template_items_user_idx on public.meal_template_items (user_id);

drop trigger if exists meal_templates_touch_updated_at on public.meal_templates;
create trigger meal_templates_touch_updated_at before update on public.meal_templates
  for each row execute function public.touch_updated_at();

-- Daily targets the user set by hand. No row means the app uses its estimate from the profile.
create table if not exists public.nutrition_targets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  calories integer not null check (calories between 800 and 8000),
  protein_g integer not null check (protein_g between 0 and 600),
  carbs_g integer not null check (carbs_g between 0 and 1200),
  fat_g integer not null check (fat_g between 0 and 400),
  updated_at timestamptz not null default now()
);

drop trigger if exists nutrition_targets_touch_updated_at on public.nutrition_targets;
create trigger nutrition_targets_touch_updated_at before update on public.nutrition_targets
  for each row execute function public.touch_updated_at();

alter table public.meal_templates enable row level security;
alter table public.meal_template_items enable row level security;
alter table public.nutrition_targets enable row level security;

drop policy if exists meal_templates_owner on public.meal_templates;
create policy meal_templates_owner on public.meal_templates for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists meal_template_items_owner on public.meal_template_items;
create policy meal_template_items_owner on public.meal_template_items for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists nutrition_targets_owner on public.nutrition_targets;
create policy nutrition_targets_owner on public.nutrition_targets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on table public.meal_templates, public.meal_template_items, public.nutrition_targets from public, anon;
grant select, insert, update, delete on table public.meal_templates, public.meal_template_items, public.nutrition_targets to authenticated;
