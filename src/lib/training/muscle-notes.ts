import type { RegionKey } from "./anatomy";

/**
 * Plain-language notes for the 17 body-map regions (anatomy.ts): the anatomical name and what the muscle does,
 * in one sentence. General anatomy for "Browse by muscle", not training advice. FITX wrote these; keep each to a
 * single sentence that is true of the muscle itself, whatever the exercise.
 */
export type MuscleNote = {
  /** The main anatomical muscles the region stands for. */
  anatomy: string;
  /** What the muscle does, in one sentence. */
  role: string;
};

export const MUSCLE_NOTES: Readonly<Record<RegionKey, MuscleNote>> = {
  neck: {
    anatomy: "Neck muscles, including the sternocleidomastoid",
    role: "The muscles of your neck hold your head up and let you nod, tilt and turn it.",
  },
  traps: {
    anatomy: "Trapezius",
    role: "Your traps run from the base of your skull to the middle of your back and lift, draw together and steady your shoulder blades.",
  },
  shoulders: {
    anatomy: "Deltoids",
    role: "Your deltoids cap your shoulders and raise your arms to the front, out to the side and behind you.",
  },
  chest: {
    anatomy: "Pectoralis major",
    role: "Your chest muscles bring your arms forwards and across your body, as in a push or a hug.",
  },
  biceps: {
    anatomy: "Biceps brachii",
    role: "Your biceps, on the front of your upper arm, bend your elbow and turn your palm to face up.",
  },
  triceps: {
    anatomy: "Triceps brachii",
    role: "Your triceps, on the back of your upper arm, straighten your elbow.",
  },
  forearms: {
    anatomy: "Forearm flexors and extensors",
    role: "The muscles of your forearm bend and straighten your wrist, turn your hand over and close your fingers to grip.",
  },
  lats: {
    anatomy: "Latissimus dorsi",
    role: "Your lats, the broad muscles down the sides of your back, pull your arms down and back towards your body.",
  },
  middle_back: {
    anatomy: "Rhomboids and middle trapezius",
    role: "The muscles between your shoulder blades pull them together and help hold your upper back upright.",
  },
  lower_back: {
    anatomy: "Erector spinae",
    role: "The muscles running alongside your lower spine straighten your back, hold it upright and let you lean back and to the side.",
  },
  abdominals: {
    anatomy: "Rectus abdominis and the obliques",
    role: "Your abdominal muscles bend your trunk forwards and to the side, twist it and brace your middle.",
  },
  abductors: {
    anatomy: "Gluteus medius and minimus, and tensor fasciae latae",
    role: "Your hip abductors, on the outside of your hip, move your leg out to the side and keep your hips level when you stand on one leg.",
  },
  adductors: {
    anatomy: "Adductor longus, brevis and magnus",
    role: "Your adductors, along your inner thigh, pull your legs in towards each other.",
  },
  glutes: {
    anatomy: "Gluteus maximus",
    role: "Your glutes straighten your hips, as when you stand up from a squat or climb stairs, and turn your thighs outwards.",
  },
  quadriceps: {
    anatomy: "Quadriceps femoris",
    role: "Your quadriceps, on the front of your thigh, straighten your knee, and one of the four also helps lift your thigh.",
  },
  hamstrings: {
    anatomy: "Biceps femoris, semitendinosus and semimembranosus",
    role: "Your hamstrings, on the back of your thigh, bend your knee and straighten your hip.",
  },
  calves: {
    anatomy: "Gastrocnemius and soleus",
    role: "Your calf muscles point your foot down, lifting your heel as you rise onto your toes, walk, run or jump.",
  },
};

export function muscleNote(region: RegionKey): MuscleNote {
  return MUSCLE_NOTES[region];
}
