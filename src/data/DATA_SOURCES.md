# FITX data sources

## Exercise library

Exercise names, instructions, muscle groups, equipment, and related text are adapted from [Free Exercise DB](https://github.com/yuhonas/free-exercise-db), revision `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5`. Its repository publishes the dataset under the [Unlicense](https://github.com/yuhonas/free-exercise-db/blob/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/UNLICENSE). FITX imports the text fields into `exercise_library`. The Phase 2 library resolves reference stills from the same pinned revision, on demand; it does not mirror them. These are sequential still images, not animated demonstrations, and unavailable frames fall back to a labeled placeholder.

## Food nutrition

These records are informational. Food entries can be incomplete; check package labels for allergy and dietary decisions.

Food search lists sources in this order: FITX staples, the USDA Foundation Foods snapshot, live USDA search (only when the server has `USDA_API_KEY`), then Open Food Facts. Each search reports which of them answered.

### FITX staples (`src/data/fitx-staples.json`)

A small, curated list of cooked staples and common Indian foods, taken only from [USDA FoodData Central](https://fdc.nal.usda.gov/) (FDC). FDC data is public domain (CC0 1.0); the suggested citation is: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov.

- **Retrieved** on 16 November 2026 from the FDC API search endpoint (`POST https://api.nal.usda.gov/fdc/v1/foods/search`). A script copied the values out of the API responses; nothing was typed by hand. Each entry keeps its `fdcId`, data type, food code and FDC publication date, so any value can be rechecked at `https://fdc.nal.usda.gov/food-details/<fdcId>/nutrients` or with `GET /v1/food/<fdcId>`.
- **Data types:** Survey (FNDDS) foods, published in FDC on 31 October 2024, and one SR Legacy food (parboiled rice; SR Legacy is dated 1 April 2019 in FDC).
- **Values** are per 100 g: energy is FDC nutrient 208 (kcal), protein 203, carbohydrate by difference 205, total fat 204.
- **Portions** are only the weights FDC publishes for that food, such as "1 item" = 38 g for idli and "1 cup, cooked" = 158 g for white rice. FNDDS "Quantity not specified" and "1 surface inch" measures are left out. FDC cups and tablespoons are US measures (236.6 ml and 14.8 ml).
- **Bare counts** ("2 rotis") use the portion marked `countDefault`: "1 medium" for roti and dosa, "1 regular/large" for samosa, the whole 10-inch naan, and the only piece weight for the rest. A typed size ("2 large rotis") picks FDC's matching size.
- **State:** every staple is `cooked` except ghee, which has none. Search ranks cooked forms before raw ones.
- **Aliases** are FITX's own search spellings (idly, chapathi, sambhar, daal) plus FDC's additional descriptions. They are not nutrition data.

Searches used (all Survey (FNDDS) unless noted):
1. `idli dosa sambar upma poha paneer chapati roti dal`
2. `rice cooked`, Survey (FNDDS) and SR Legacy, all words required
3. `paratha naan puri biryani khichdi chana rajma samosa pakora kheer raita lassi korma tikka tandoori vada pongal pulao poha chole aloo ghee curd`

Searched for but not found among FNDDS foods: poha, khichdi, rajma, pongal, kheer, raita, lassi, korma, tikka, tandoori, pulao and chole.

Left out on purpose:
- **FNDDS "Cheese, paneer"** (fdcId 2705740, food code 14110050). Its recipe is 97 g whole milk plus 3 g vinegar, concentrated with all the milk sugar kept, which gives 22.5 g carbohydrate and 15.9 g protein per 100 g. Real paneer loses that sugar with the whey, so the entry misstates both. Until a better source is added (Phase 5), paneer comes from package labels. "Palak Paneer" (2709631) is kept: its recipe uses cottage cheese, not that entry.
- **FNDDS "Pakora"** (fdcId 2710066): not a staple, and 125 kcal per 100 g is low for a fried snack. Left for the Phase 5 review.

Worth knowing about values that are kept:
- "Upma" (87 kcal per 100 g) is a moist recipe of cream of wheat, onion, tomato, oil and water; drier home recipes are higher.
- "Biryani with chicken" (104 kcal per 100 g) is a home recipe with potato and yogurt; restaurant biryani is usually richer.
- "Dal" (145 kcal per 100 g) is boiled lentils with a little ghee.

### How amounts are worked out

`src/lib/domain/food-query.ts` reads the amount out of what the user types ("3 idlis", "150 g rice", "1.5 cups dal").
- Grams, kilograms, ounces and pounds are exact conversions.
- Pieces and cups use the food's FDC portion weight, and the app labels the result a **portion estimate** with the grams it used.
- Teaspoons, tablespoons, ml and litres are converted from the food's nearest FDC volume measure in US units (for example, 2 tsp of ghee from FDC's 1 tablespoon = 14 g). These are also portion estimates.
- When a unit has no known weight for that food, such as a katori, bowl, plate or glass, or a count for a food without a piece weight, the app asks for grams instead of guessing.

### USDA Foundation Foods snapshot (`src/data/usda-foundation-foods.json`)

A compact selection from USDA FoodData Central Foundation Foods, April 2026, with values per 100 g. FITX reads "raw" or "cooked" from each description and shows it as a label. "Dry" counts as raw only for grains, pulses and pasta, so "Lentils, dry" is labelled raw while "Cheese, dry white" is not.

### Live USDA search (optional)

When the server has `USDA_API_KEY`, search also asks the FDC API for Survey (FNDDS), Foundation, SR Legacy and Branded foods. The key is sent in the `X-Api-Key` header, never in the URL. FNDDS household measures and Branded serving sizes in grams become portions.

### Open Food Facts

Packaged products and barcode results come from [Open Food Facts](https://world.openfoodfacts.org/), whose database is under the ODbL and whose images are under CC BY-SA ([terms](https://world.openfoodfacts.org/terms-of-use)). Its values are entered by the community from package labels; FITX labels them "Package label (Open Food Facts)".
- Only per-100 g fields are used, because the plain energy field can be per serving.
- Labels that give only kJ are converted at 4.184 kJ per kcal.
- A declared 0 kcal (water, diet drinks) is kept, unless the same label lists more than 1 g of protein, carbohydrate and fat per 100 g, which marks an entry error.
- The User-Agent comes from `OPEN_FOOD_FACTS_USER_AGENT`. Open Food Facts asks for "AppName/Version (contact email)"; a value without a contact gets `(https://fitnessx.vercel.app)` added, and the default is `FITX/1.0 (https://fitnessx.vercel.app)`.
