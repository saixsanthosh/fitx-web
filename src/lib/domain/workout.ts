export type ExerciseRecord = {
  id: string;
  name: string;
  primary_muscle: string;
  secondary_muscles: string[];
  equipment: string[];
  locations: string[];
  difficulty: string;
  movement_pattern: string;
  recommended_sets: number;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  alternatives: string[];
};

export type WorkoutPreferences = {
  workout_location?: string;
  equipment?: string[];
  fitness_level?: string;
  session_duration_minutes?: number;
  workout_split?: string;
};

export function generateWorkout(exercises: ExerciseRecord[], preferences: WorkoutPreferences, date = new Date()) {
  const location = preferences.workout_location ?? "gym";
  const available = new Set((preferences.equipment ?? ["bodyweight"]).map(normalize));
  available.add("bodyweight");
  const level = preferences.fitness_level ?? "beginner";
  const duration = Math.max(20, preferences.session_duration_minutes ?? 45);
  const maxExercises = Math.min(9, Math.max(4, Math.floor(duration / 8)));
  const targets = muscleTargets(preferences.workout_split ?? "full_body", date);

  const eligible = exercises.filter((exercise) => {
    const locationMatches = exercise.locations.includes(location) || (location === "both" && (exercise.locations.includes("home") || exercise.locations.includes("gym")));
    const equipmentMatches = exercise.equipment.every((item) => available.has(normalize(item)));
    const levelMatches = level === "advanced" || exercise.difficulty !== "advanced";
    return locationMatches && equipmentMatches && levelMatches;
  });

  const selected: ExerciseRecord[] = [];
  const usedPatterns = new Set<string>();
  for (const muscle of targets) {
    const match = eligible.find((exercise) =>
      !selected.some((selectedExercise) => selectedExercise.id === exercise.id) &&
      !usedPatterns.has(exercise.movement_pattern) &&
      (normalize(exercise.primary_muscle) === muscle || exercise.secondary_muscles.map(normalize).includes(muscle))
    );
    if (match) {
      selected.push(match);
      usedPatterns.add(match.movement_pattern);
    }
  }
  for (const exercise of eligible) {
    if (selected.length >= maxExercises) break;
    if (!selected.some((item) => item.id === exercise.id) && !usedPatterns.has(exercise.movement_pattern)) {
      selected.push(exercise);
      usedPatterns.add(exercise.movement_pattern);
    }
  }
  return selected.slice(0, maxExercises).map((exercise, index) => ({
    exercise,
    sort_order: index,
    target_sets: exercise.recommended_sets,
    reps_min: exercise.reps_min,
    reps_max: exercise.reps_max,
    rest_seconds: exercise.rest_seconds,
  }));
}

export function estimateOneRepMax(weightKg: number, reps: number) {
  if (weightKg <= 0 || reps <= 0) return 0;
  return Math.round(weightKg * (1 + Math.min(reps, 12) / 30) * 10) / 10;
}

function muscleTargets(split: string, date: Date) {
  if (split === "push_pull_legs") {
    const day = date.getDay() % 3;
    return day === 0 ? ["chest", "shoulders", "triceps"] : day === 1 ? ["back", "biceps", "forearms"] : ["quadriceps", "hamstrings", "glutes", "calves"];
  }
  if (split === "upper_lower") {
    return date.getDay() % 2 === 0
      ? ["chest", "back", "shoulders", "biceps", "triceps"]
      : ["quadriceps", "hamstrings", "glutes", "calves"];
  }
  return ["chest", "back", "quadriceps", "hamstrings", "shoulders", "core"];
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
