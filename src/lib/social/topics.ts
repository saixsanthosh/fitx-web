/** Explore's topics: the category filters on Discover and the up to three a member may give a post. */
export const TOPICS = [
  { key: "bodybuilding", label: "Bodybuilding" },
  { key: "weight_loss", label: "Weight loss" },
  { key: "muscle_gain", label: "Muscle gain" },
  { key: "home_workouts", label: "Home workouts" },
  { key: "gym_workouts", label: "Gym workouts" },
  { key: "nutrition", label: "Nutrition" },
  { key: "motivation", label: "Motivation" },
] as const;

export type TopicKey = (typeof TOPICS)[number]["key"];
export const MAX_POST_TOPICS = 3;

const KEYS = new Set<string>(TOPICS.map((topic) => topic.key));

export function isTopic(value: unknown): value is TopicKey {
  return typeof value === "string" && KEYS.has(value);
}

export function topicLabel(key: string): string {
  return TOPICS.find((topic) => topic.key === key)?.label ?? key;
}

/** Topics whose name starts a word with the query ("loss" finds Weight loss). */
export function matchTopics(query: string): TopicKey[] {
  const q = query.trim().replace(/^[#@]/, "").toLowerCase();
  if (!q) return [];
  return TOPICS.filter((topic) => topic.label.toLowerCase().split(/\s+/).some((word) => word.startsWith(q)) || topic.key.startsWith(q.replace(/\s+/g, "_")))
    .map((topic) => topic.key);
}
