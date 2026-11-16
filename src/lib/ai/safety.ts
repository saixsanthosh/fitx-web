import "server-only";

/**
 * Safety checks that run before any model sees a message.
 *
 * Crisis language (self-harm, an eating disorder, a medical emergency) stops the request: FITX shows
 * its own fixed safety note with real help lines instead of asking a model for fitness advice. Those
 * notes are saved with role "safety" and the page labels them as FITX's, never as AI replies.
 * Other health topics (a condition, pregnancy, an injury, a crash-diet request) go to the model with
 * stricter instructions, and FITX adds its own reminder under the reply.
 */

export type SafetyStopTopic = "self_harm" | "eating_disorder" | "emergency";
export type SafetyCaution = "medical" | "pregnancy" | "injury" | "extreme_diet";
export type SafetyScreen = { kind: "stop"; topic: SafetyStopTopic; message: string } | { kind: "ok"; cautions: SafetyCaution[] };

const SELF_HARM =
  /\b(kill(?:ing)? myself|suicid(?:e|al)|end(?:ing)? my life|end it all|want to die|wanna die|don'?t want to (?:live|be alive|exist)|self[- ]?harm(?:ing)?|hurt(?:ing)? myself|cut(?:ting)? myself|no reason to live|better off dead)\b/i;
const EATING_DISORDER =
  /\b(make myself (?:throw up|vomit|sick)|throw(?:ing)? up after (?:eating|meals?|food)|vomit(?:ing)? after (?:eating|meals?|food)|purg(?:e|ing) (?:after|food|meals?|calories)|binge(?:ing)? and purg|(?:laxatives?|diuretics?|diet pills?)\b[^.?!]{0,40}\b(?:lose|losing|weight|slim|thin|fat)|starv(?:e|ing) myself|pro[- ]?ana\b|thinspo|anorexi\w*|bulimi\w*|stop eating (?:completely|entirely|for days)|not eat(?:ing)? anything for (?:days|a week)|punish myself (?:for eating|with exercise)|hate (?:myself|my body) (?:when|after) i eat)\b/i;
const EMERGENCY =
  /\b(chest (?:pain|tightness)|heart attack|can'?t breathe|cannot breathe|trouble breathing|struggling to breathe|faint(?:ed|ing)|passed out|blacked out|seizures?|(?:having|had|signs of) a stroke|anaphyla\w*|throat (?:is )?(?:closing|swelling)|severe allergic|coughing (?:up )?blood)\b/i;

const MEDICAL =
  /\b(diabet\w*|insulin|metformin|kidney|renal|liver disease|heart (?:disease|condition|problem)|blood pressure|hypertension|cholesterol|thyroid|pcos|pcod|cancer|chemo\w*|medications?|medicines?(?! ball)|surgery|asthma|epilep\w*|arthritis|gout|crohn'?s|coeliac|celiac|doctor said|prescribed)\b/i;
const PREGNANCY = /\b(pregnan\w*|breast-?feed\w*|lactating|postpartum|post-partum|trimester)\b/i;
const INJURY =
  /\b(injur\w*|sprain\w*|fracture\w*|torn|herniat\w*|slipped disc|sciatica|tendinitis|tendonitis|ligament|acl|mcl|rotator cuff|(?:back|knee|shoulder|hip|wrist|neck) pain|hurts when)\b/i;
const EXTREME =
  /\b(dry fast\w*|water fast\w*|only (?:drink|eat) water|steroids?|sarms?|clenbuterol|fat burners?|diuretics?|laxatives?)\b/i;

export const HELP_LINES =
  "In India you can call Tele-MANAS, free and open day and night, on 14416 or 1-800-891-4416. Outside India, findahelpline.com lists free services near you.";

const STOP_MESSAGES: Record<SafetyStopTopic, string> = {
  self_harm: [
    "I'm really sorry you're feeling this way. You deserve support right now, and a fitness coach isn't the right help for this.",
    "If you might act on these thoughts or you're in danger, call 112 (India's emergency number) or your local emergency number now.",
    HELP_LINES,
    "If you can, tell someone you trust how you're feeling.",
  ].join("\n\n"),
  eating_disorder: [
    "Thank you for telling me. What you describe can be a sign of an eating disorder, and it deserves care from someone qualified, not a diet plan from an app.",
    "Please talk to a doctor or someone you trust about it. " + HELP_LINES,
    "FITX Coach won't make calorie-cutting plans while this is going on, but it's here for gentle, general questions about moving and eating well.",
  ].join("\n\n"),
  emergency: [
    "This could be a medical emergency. Stop exercising and call 112 (India) or your local emergency number now, or ask someone nearby to help you.",
    "Don't wait for an app to answer this.",
  ].join("\n\n"),
};

const CAUTION_NOTES: Record<SafetyCaution, string> = {
  medical: "FITX Coach gives general fitness and food guidance, not medical advice. With a medical condition or medication, check changes with your doctor first.",
  pregnancy: "During pregnancy or while breastfeeding, check food and exercise changes with your doctor or midwife.",
  injury: "With an injury or pain, stop any exercise that hurts and see a doctor or physiotherapist before training it.",
  extreme_diet: "FITX Coach doesn't make crash diets, fasting plans or supplement-cutting plans. Slow, steady changes are safer and last longer.",
};

export function screenMessage(text: string): SafetyScreen {
  const value = text.normalize("NFKC");
  if (SELF_HARM.test(value)) return { kind: "stop", topic: "self_harm", message: STOP_MESSAGES.self_harm };
  if (EMERGENCY.test(value)) return { kind: "stop", topic: "emergency", message: STOP_MESSAGES.emergency };
  if (EATING_DISORDER.test(value)) return { kind: "stop", topic: "eating_disorder", message: STOP_MESSAGES.eating_disorder };
  const cautions: SafetyCaution[] = [];
  if (MEDICAL.test(value)) cautions.push("medical");
  if (PREGNANCY.test(value)) cautions.push("pregnancy");
  if (INJURY.test(value)) cautions.push("injury");
  if (EXTREME.test(value) || asksForVeryLowCalories(value) || asksForFastLoss(value)) cautions.push("extreme_diet");
  return { kind: "ok", cautions };
}

export function cautionNotes(cautions: readonly SafetyCaution[]): string[] {
  return cautions.map((caution) => CAUTION_NOTES[caution]);
}

/** "800 calories a day", "eat 500 kcal per day". */
function asksForVeryLowCalories(text: string) {
  const match = /\b(\d{2,4})\s*(?:k?cals?|calories)\s*(?:a|per|each|\/)\s*day\b/i.exec(text);
  return Boolean(match && Number(match[1]) < 1000);
}

/** "lose 10 kg in 2 weeks": faster than about 1 kg a week. */
function asksForFastLoss(text: string) {
  const match = /\blose\s+(\d+(?:\.\d+)?)\s*(kg|kgs|kilos?|lbs?|pounds?)\s+in\s+(\d+|a|one|two)\s*(days?|weeks?|months?)\b/i.exec(text);
  if (!match) return false;
  const amount = Number(match[1]) * (/^(lb|pound)/i.test(match[2]) ? 0.4536 : 1);
  const count = /^\d+$/.test(match[3]) ? Number(match[3]) : match[3].toLowerCase() === "two" ? 2 : 1;
  const weeks = /^day/i.test(match[4]) ? count / 7 : /^month/i.test(match[4]) ? count * 4.35 : count;
  return weeks > 0 && amount / weeks > 1;
}

/** Instructions every system prompt carries. */
export function safetyRules(options: { minor: boolean; calorieFloor: number }) {
  const rules = [
    "You give general wellness, fitness and food guidance only. You are not a doctor, dietitian or physiotherapist: never diagnose, never give medication or supplement doses, never tell someone to stop or change a medicine.",
    `Never suggest eating fewer than ${options.calorieFloor} kcal a day, fasting longer than 14 hours, dehydrating, purging, laxatives, diuretics, fat burners, steroids or SARMs, or losing more than about 1% of body weight a week.`,
    "If the member mentions a medical condition, pregnancy, an injury, pain or medication, keep advice general and safe and recommend checking with a doctor, physiotherapist or registered dietitian.",
    "If the member seems distressed about food, weight or their body, be kind, do not give calorie targets, and suggest talking to someone they trust or a professional.",
  ];
  if (options.minor) {
    rules.push(
      "The member is under 18. Do not give calorie targets, deficits or weight-loss diets. Do not suggest supplements of any kind (including protein powder, creatine and fat burners). Focus on regular balanced meals, sleep, water, fun activity and learning good technique with light loads. Suggest involving a parent, guardian, school coach or doctor for bigger changes.",
    );
  }
  return rules;
}

/** Lowest daily intake FITX will plan for: common adult guidance, and no deficits for under-18s. */
export function calorieFloor(sex: string | null | undefined) {
  return sex === "male" ? 1500 : sex === "female" ? 1200 : 1350;
}
