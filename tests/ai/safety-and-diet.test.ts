import "./support/hooks.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const { screenMessage, cautionNotes, calorieFloor, safetyRules } = await import("@/lib/ai/safety");
const { allergyRulesFrom, dietRulesFrom, foodConflict } = await import("@/lib/ai/diet-rules");
const { detectTask } = await import("@/lib/ai/coach");

describe("safety screen", () => {
  test("self-harm, eating-disorder and emergency messages stop before any model with real help lines", () => {
    const selfHarm = screenMessage("Honestly I want to die, what's the point of training");
    assert.equal(selfHarm.kind, "stop");
    assert.ok(selfHarm.kind === "stop" && selfHarm.topic === "self_harm" && selfHarm.message.includes("14416") && selfHarm.message.includes("112"));

    for (const text of ["How do I make myself throw up after dinner", "Can laxatives help me lose weight faster", "I starve myself all week, is that ok", "pro ana tips please"]) {
      const result = screenMessage(text);
      assert.ok(result.kind === "stop" && result.topic === "eating_disorder", text);
    }
    for (const text of ["I have chest pain during squats", "My friend fainted at the gym", "throat is swelling after eating peanuts"]) {
      const result = screenMessage(text);
      assert.ok(result.kind === "stop" && result.topic === "emergency", text);
    }
  });

  test("ordinary gym language is not mistaken for a crisis", () => {
    for (const text of ["I'm starving after leg day, what should I eat?", "Starting my cutting phase next week", "Is breast stroke good cardio?", "medicine ball slams form tips", "This workout is killing my legs", "I'm dying to try deadlifts"]) {
      const result = screenMessage(text);
      assert.equal(result.kind, "ok", text);
      assert.ok(result.kind === "ok" && !result.cautions.includes("medical"), text);
    }
  });

  test("health topics go to the model with cautions and FITX's own note", () => {
    const pregnant = screenMessage("I'm 20 weeks pregnant, can I still lift?");
    assert.ok(pregnant.kind === "ok" && pregnant.cautions.includes("pregnancy"));
    const medical = screenMessage("I take metformin for diabetes, what breakfast?");
    assert.ok(medical.kind === "ok" && medical.cautions.includes("medical"));
    const injured = screenMessage("knee pain when I squat");
    assert.ok(injured.kind === "ok" && injured.cautions.includes("injury"));
    for (const text of ["Give me an 800 calories a day diet", "How do I lose 10 kg in 2 weeks", "best fat burners?"]) {
      const result = screenMessage(text);
      assert.ok(result.kind === "ok" && result.cautions.includes("extreme_diet"), text);
    }
    const gentle = screenMessage("How do I lose 2 kg in a month?");
    assert.ok(gentle.kind === "ok" && !gentle.cautions.includes("extreme_diet"));
    assert.equal(cautionNotes(["injury"]).length, 1);
  });

  test("crisis messages in Hindi (Devanagari) and Hinglish stop too", () => {
    const selfHarm = ["mujhe marna hai", "main marna chahta hoon", "jeena nahi chahti ab", "aatmhatya ke khayal aate hain", "मैं मरना चाहता हूँ", "मुझे आत्महत्या के ख्याल आते हैं", "ख़ुदकुशी", "ख\u093Cुदकुशी"];
    for (const text of selfHarm) {
      const result = screenMessage(text);
      assert.ok(result.kind === "stop" && result.topic === "self_harm", text);
    }
    for (const text of ["seene mein dard ho raha hai", "सीने में दर्द है", "wo behosh ho gaya"]) {
      const result = screenMessage(text);
      assert.ok(result.kind === "stop" && result.topic === "emergency", text);
    }
    for (const text of ["khane ke baad ulti karti hoon", "maine khana chhod diya hai", "मैंने खाना छोड़ दिया"]) {
      const result = screenMessage(text);
      assert.ok(result.kind === "stop" && result.topic === "eating_disorder", text);
    }
    assert.equal(screenMessage("mujhe protein chahiye, kya khaun?").kind, "ok");
    // Languages FITX can't screen are covered by the prompt's own fallback.
    assert.ok(safetyRules({ minor: false, calorieFloor: 1200 }).some((rule) => /in any language/.test(rule) && /14416/.test(rule) && /112/.test(rule)));
  });

  test("asking for less than the member's own minimum is a crash-diet request", () => {
    const male = screenMessage("Plan my meals, keep it under 1400 calories", { floor: 1500 });
    assert.ok(male.kind === "ok" && male.cautions.includes("extreme_diet"));
    const female = screenMessage("Plan my meals, keep it under 1400 calories", { floor: 1200 });
    assert.ok(female.kind === "ok" && !female.cautions.includes("extreme_diet"));
    for (const text of ["max 900 kcal", "only 1000 calories", "eat 700 kcal per day"]) {
      const result = screenMessage(text, { floor: 1200 });
      assert.ok(result.kind === "ok" && result.cautions.includes("extreme_diet"), text);
    }
  });

  test("teens get stricter rules and no adult calorie floors are lowered", () => {
    assert.ok(safetyRules({ minor: true, calorieFloor: 1350 }).some((rule) => rule.includes("under 18")));
    assert.ok(!safetyRules({ minor: false, calorieFloor: 1350 }).some((rule) => rule.includes("under 18")));
    assert.equal(calorieFloor("female"), 1200);
    assert.equal(calorieFloor("male"), 1500);
    assert.equal(calorieFloor(null), 1350);
  });
});

describe("diet and allergy rules", () => {
  const none = { rules: [], other: [] };
  test("common Indian dishes whose names hide an ingredient are caught", () => {
    const cases: Array<[string, Parameters<typeof foodConflict>[1], Parameters<typeof foodConflict>[2]["rules"]]> = [
      ["Dal makhani", ["vegan"], []], ["Dal makhani", [], ["dairy"]], ["Murgh makhani", ["vegetarian"], []], ["Murg malai tikka", ["vegetarian"], []],
      ["Kaleji fry", ["vegetarian"], []], ["Kadhi chawal", [], ["dairy"]], ["Sandesh", [], ["dairy"]], ["Veg korma", ["vegan"], []],
      ["Navratan korma", [], ["dairy"]], ["Gajar halwa", [], ["dairy"]], ["Phirni", [], ["dairy"]], ["Mishti doi", [], ["dairy"]], ["Chaach", ["vegan"], []],
      ["Veg momos", [], ["wheat"]], ["Rawa dosa", [], ["wheat"]], ["Veg chowmein", [], ["wheat"]], ["Veg chow mein", [], ["wheat"]], ["Rusk", [], ["wheat"]],
      ["Chole bhature", [], ["wheat"]], ["Kerala parotta", [], ["wheat"]], ["Puran poli", [], ["wheat"]], ["Paneer kathi roll", [], ["wheat"]],
      ["Veg tortilla wrap", [], ["wheat"]], ["Sabudana khichdi", [], ["peanuts"]], ["Kanda poha", [], ["peanuts"]], ["Chivda", [], ["peanuts"]],
      ["Shorshe ilish", [], ["mustard"]], ["Chingri malai curry", [], ["shellfish"]],
    ];
    for (const [dish, diet, rules] of cases) assert.ok(foodConflict(dish, diet, { rules, other: [] }), `${dish} for ${[...diet, ...rules].join(", ")}`);
    // Similar names that are fine.
    assert.equal(foodConflict("Roasted makhana", ["vegan"], { rules: ["dairy"], other: [] }), null, "fox nuts are not makhani");
    assert.equal(foodConflict("Masala dosa", [], { rules: ["wheat"], other: [] }), null);
    assert.equal(foodConflict("Idli sambar", ["vegan"], { rules: ["peanuts", "dairy", "wheat"], other: [] }), null);
    assert.equal(foodConflict("Raita", [], { rules: ["mustard"], other: [] }), null, "the word rai (mustard) is not matched inside raita");
  });

  test("reads FITX's stored choices", () => {
    assert.deepEqual(dietRulesFrom(["Vegetarian"]), ["vegetarian"]);
    assert.deepEqual(dietRulesFrom(["non_vegetarian"]), []);
    assert.deepEqual(dietRulesFrom(["eggetarian"]), ["eggetarian"]);
    assert.deepEqual(dietRulesFrom(["Vegan", "Halal"]).sort(), ["halal", "vegan"]);
    assert.deepEqual(allergyRulesFrom(["Peanuts", "Tree nuts", "Wheat", "Dairy", "gluten", "kiwi"]), { rules: ["peanuts", "tree_nuts", "wheat", "dairy"], other: ["kiwi"] });
  });

  test("vegetarian, eggetarian, vegan, pescatarian, halal and Jain", () => {
    assert.ok(foodConflict("Chicken curry", ["vegetarian"], none));
    assert.ok(foodConflict("Boiled eggs", ["vegetarian"], none));
    assert.equal(foodConflict("Palak paneer", ["vegetarian"], none), null);
    assert.equal(foodConflict("Egg bhurji", ["eggetarian"], none), null);
    assert.ok(foodConflict("Fish curry", ["eggetarian"], none));
    for (const food of ["Paneer tikka", "Ghee rice", "Curd", "Honey oats", "Masala chai", "Butter naan"]) assert.ok(foodConflict(food, ["vegan"], none), food);
    for (const food of ["Coconut milk curry", "Peanut butter toast", "Tofu stir fry", "Dal"]) assert.equal(foodConflict(food, ["vegan"], none), null, food);
    assert.equal(foodConflict("Grilled salmon", ["pescatarian"], none), null);
    assert.ok(foodConflict("Mutton biryani", ["pescatarian"], none));
    assert.ok(foodConflict("Pork ribs", ["halal"], none));
    assert.ok(foodConflict("Aloo paratha", ["jain"], none));
  });

  test("allergies, including Indian names", () => {
    const peanuts = { rules: ["peanuts" as const], other: [] };
    assert.ok(foodConflict("Groundnut chutney", [], peanuts));
    assert.ok(foodConflict("Peanut chikki", [], peanuts));
    assert.equal(foodConflict("Coconut chutney", [], peanuts), null);
    const nuts = { rules: ["tree_nuts" as const], other: [] };
    assert.ok(foodConflict("Kaju katli", [], nuts));
    assert.ok(foodConflict("Mixed nuts", [], nuts));
    assert.equal(foodConflict("Coconut ladoo with nutmeg", [], nuts), null);
    const wheat = { rules: ["wheat" as const], other: [] };
    for (const food of ["Roti", "Rava dosa", "Upma", "Pav bhaji"]) assert.ok(foodConflict(food, [], wheat), food);
    for (const food of ["Idli", "Plain dosa", "Rice and sambar"]) assert.equal(foodConflict(food, [], wheat), null, food);
    const dairy = { rules: ["dairy" as const], other: [] };
    assert.ok(foodConflict("Buttermilk", [], dairy));
    assert.ok(foodConflict("Ice cream", [], dairy));
    assert.equal(foodConflict("Peanut butter", [], dairy), null);
    assert.ok(foodConflict("Kiwi smoothie", [], { rules: [], other: ["kiwi"] }));
  });
});

describe("intent", () => {
  test("only clear requests for a whole plan become plans", () => {
    assert.equal(detectTask("Can you make me a meal plan for today?"), "meal_plan");
    assert.equal(detectTask("I need a diet plan for muscle gain"), "meal_plan");
    assert.equal(detectTask("What should I eat today?"), "meal_plan");
    assert.equal(detectTask("Give me a workout plan for my home gym"), "workout_plan");
    assert.equal(detectTask("Is my meal plan healthy?"), "chat");
    assert.equal(detectTask("How much protein do I need?"), "chat");
  });
});

describe("intent: imperative requests", () => {
  test("'Plan my meals' and 'Plan a workout' start plans; questions about plans stay chat", () => {
    assert.equal(detectTask("Plan my meals for today"), "meal_plan");
    assert.equal(detectTask("Plan a workout for tonight"), "workout_plan");
    assert.equal(detectTask("Should I plan my meals around training?"), "chat");
    assert.equal(detectTask("Is my workout plan too long?"), "chat");
  });
});

describe("onboarding v2 values (diet_type, food_rules, allergy keys)", () => {
  test("diet_type and food_rules map to rules; 'both' and 'non_vegetarian' restrict nothing", () => {
    assert.deepEqual(dietRulesFrom(["both"]), []);
    assert.deepEqual(dietRulesFrom(["non_vegetarian", "low_carb"]), []);
    assert.deepEqual(dietRulesFrom(["vegetarian", "jain"]).sort(), ["jain", "vegetarian"]);
    assert.deepEqual(dietRulesFrom(["both", "no_onion_garlic", "no_beef", "no_pork"]).sort(), ["no_beef", "no_onion_garlic", "no_pork"]);
  });

  test("allergy keys with underscores are understood, not dropped", () => {
    assert.deepEqual(allergyRulesFrom(["tree_nuts", "wheat_gluten", "sesame", "Kiwi"]), { rules: ["tree_nuts", "wheat", "sesame"], other: ["kiwi"] });
  });

  test("food rules are enforced", () => {
    const none = { rules: [], other: [] };
    assert.ok(foodConflict("Onion pakoda", ["no_onion_garlic"], none));
    assert.equal(foodConflict("Plain dosa", ["no_onion_garlic"], none), null);
    assert.ok(foodConflict("Beef curry", ["no_beef"], none));
    assert.equal(foodConflict("Veg burger", ["no_beef"], none), null);
    assert.ok(foodConflict("Pork sausage", ["no_pork"], none));
  });
});
