import "server-only";

/**
 * Shapes shared by the AI router, the coach endpoints and (as `import type`) the coach page.
 * Types only: nothing here runs, so client components may import these types without pulling in
 * server code.
 */

export type ProviderId = "gemini" | "groq" | "openrouter" | "ollama";

/** What a request is for. Each task has its own provider order (see registry.ts). */
export type AiTask = "chat" | "meal_plan" | "workout_plan" | "swap";

export type AiMessage = { role: "user" | "assistant"; content: string };

/** A JSON schema in the subset every provider accepts (type, properties, required, items, enum, description). */
export type JsonSchema = {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  nullable?: boolean;
};

export type AiRequest = {
  task: AiTask;
  system: string;
  messages: AiMessage[];
  maxOutputTokens: number;
  temperature: number;
  /** Set for structured tasks: the reply must be one JSON object matching this schema. */
  json?: { name: string; schema: JsonSchema };
};

export type AiUsage = { inputTokens?: number; outputTokens?: number };

export type AttemptOutcome = "ok" | "rate_limited" | "unavailable" | "timeout" | "invalid_response" | "auth" | "bad_request" | "refused" | "skipped";

/** One provider attempt, for logs and diagnostics. Never holds prompts, replies or keys. */
export type AttemptLog = { provider: ProviderId; model: string; outcome: AttemptOutcome; ms: number; status?: number };

export type AiTextResult = { text: string; provider: ProviderId; model: string; usage?: AiUsage; attempts: AttemptLog[] };

/** Why the coach cannot answer right now. Each maps to an honest message on the page. */
export type UnavailableReason = "disabled" | "not_configured" | "at_capacity" | "refused";

export type CoachQuota = { kind: "chat" | "plan"; used: number; limit: number; resetsAt: string };

/** One food line of a checked meal plan, as the page shows it. Values are for the portion shown. */
export type CoachFoodItem = {
  key: string;
  name: string;
  /** "3 pieces (114 g)" */
  portion: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** "database": matched in FITX's food data; "label": a package label; "ai_estimate": the coach's own estimate. */
  basis: "database" | "label" | "ai_estimate";
  /** What the values are, in the words the Nutrition page uses ("USDA typical recipe", "AI estimate"). */
  basisLabel: string;
  /** Where the values come from ("USDA FoodData Central", "Open Food Facts"), or null for an AI estimate. */
  source: string | null;
  /** The database entry the values come from ("Bread, chappatti or roti"), or null for an AI estimate. */
  matchedName: string | null;
  /** True when the portion weight is an average (a USDA piece or cup weight, or the coach's estimate). */
  portionEstimated: boolean;
  image: string | null;
  cost: "low" | "medium" | "high" | null;
  note: string | null;
  /** The custom food proposal this line becomes when the member presses "Add to My Food Plan". */
  actionId: string | null;
};

export type CoachMeal = { key: string; name: string; items: CoachFoodItem[]; totals: Macros; actionId: string | null };

export type Macros = { calories: number; protein: number; carbs: number; fat: number };

export type CoachMealPlan = {
  kind: "meal_plan";
  title: string;
  summary: string;
  meals: CoachMeal[];
  totals: Macros;
  /** The member's daily target the plan was checked against, or null when FITX cannot estimate one. */
  target: Macros | null;
  budget: string | null;
  tips: string[];
  /** Honest notes from FITX's checks ("Removed peanut chutney: it contains peanuts"). */
  checks: string[];
};

export type CoachWorkoutExercise = {
  exerciseId: string;
  name: string;
  primaryMuscle: string;
  equipment: string[];
  sets: number;
  repsMin: number;
  repsMax: number;
  restSeconds: number;
  /** Seconds per set for holds such as a plank; null for rep-based exercises. */
  holdSeconds: number | null;
  note: string | null;
};

export type CoachWorkoutPlan = {
  kind: "workout_plan";
  title: string;
  summary: string;
  location: string;
  exercises: CoachWorkoutExercise[];
  tips: string[];
  checks: string[];
  actionId: string | null;
};

export type CoachSwap = {
  kind: "swap";
  /** The proposal this replaces. */
  replaces: string;
  item: CoachFoodItem;
  /** Why it is a fair swap, or an honest note when it is not a close match. */
  note: string;
};

/**
 * Structured parts of a message: a checked plan, and FITX's own notes (safety reminders, what its
 * checks changed). Notes are written by FITX, never by the model.
 */
export type CoachMessageData = { plan?: CoachMealPlan | CoachWorkoutPlan; notes?: string[] };

/** A message as the page renders it. */
export type CoachMessageView = {
  id: string;
  role: "user" | "assistant" | "safety";
  task: "chat" | "meal_plan" | "workout_plan";
  content: string;
  data: CoachMessageData | null;
  provider: string | null;
  createdAt: string;
};

export type CoachActionView = {
  id: string;
  messageId: string;
  kind: "food" | "meal" | "workout_plan";
  status: "proposed" | "applied" | "dismissed";
  /** Set for "Can't afford this?" replacements. */
  swap: CoachSwap | null;
};

export type CoachThreadSummary = { id: string; title: string; updatedAt: string };

/** One line of the NDJSON stream the chat endpoint returns. */
export type CoachStreamEvent =
  | { type: "thread"; threadId: string; title: string; userMessageId: string }
  | { type: "task"; task: "chat" | "meal_plan" | "workout_plan" }
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "message"; message: CoachMessageView; actions: CoachActionView[] }
  | { type: "done"; quota: CoachQuota | null }
  | { type: "error"; code: CoachErrorCode; message: string; retryAt?: string };

export type CoachErrorCode =
  | "paused"
  | "not_configured"
  | "not_available"
  | "consent_required"
  | "quota"
  | "at_capacity"
  | "refused"
  | "invalid"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "plans_unavailable"
  | "failed";
