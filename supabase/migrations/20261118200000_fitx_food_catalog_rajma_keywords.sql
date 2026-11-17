-- Food search: "rajma" finds kidney beans. USDA names them only "Kidney beans" and "Beans, kidney, ...", so the
-- everyday Indian name found nothing in FITX's catalogue (signed-in e2e run, 2026-11-17).
-- Keywords help search find a food but never select it (20261118140000): "rajma" often means the curry, so the
-- member still taps the kidney beans they mean, and the values stay USDA's own.
-- Needs 20261118140000. The foods come from the food parts 20261118140010 to 20261118140014; on a catalogue
-- without them this changes nothing. Running it again changes nothing either: rows that already have both words
-- are left alone, and food_catalog_before_write() removes duplicate keywords and rebuilds search_text.
update public.food_catalog
set keywords = keywords || array['rajma', 'rajmah']
where id in (
    '2707379', -- Kidney beans, NFS (FNDDS)
    '2707380', -- Kidney beans, from dried, fat added (FNDDS)
    '2707381', -- Kidney beans, from dried, no added fat (FNDDS)
    '2707382', -- Kidney beans, from canned, fat added (FNDDS)
    '2644289', -- Beans, kidney, dark red, canned, sodium added, sugar added, drained and rinsed (Foundation)
    '2644290'  -- Beans, kidney, light red, canned, sodium added, sugar added, drained and rinsed (Foundation)
  )
  and not keywords @> array['rajma', 'rajmah'];
