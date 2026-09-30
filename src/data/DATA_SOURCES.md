# FITX data sources

## Exercise library

Exercise names, instructions, muscle groups, equipment, and related text are adapted from [Free Exercise DB](https://github.com/yuhonas/free-exercise-db), revision `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5`. Its text data is released under the [Unlicense](https://github.com/yuhonas/free-exercise-db/blob/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/UNLICENSE). FITX imports the text fields into `exercise_library`; images are excluded.

## Food nutrition

The offline food catalog in `src/data/usda-foundation-foods.json` is a compact selection from USDA FoodData Central Foundation Foods, April 2026. USDA FoodData Central data is public domain and may be reused with attribution. FITX displays values per 100 g. Branded products and barcode results may be retrieved from [Open Food Facts](https://world.openfoodfacts.org/), under its [database and data reuse terms](https://world.openfoodfacts.org/terms-of-use).

These records are informational. Food entries can be incomplete; check package labels for allergy and dietary decisions.
