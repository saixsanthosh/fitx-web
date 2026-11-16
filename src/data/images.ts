// Curated, verified real fitness imagery (Unsplash CDN). All return 200 / image-jpeg.

const u = (id: string, w = 800) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

export const IMG = {
  // Hero / marketing
  heroGym: u("1534438327276-14e5300c3a48", 1600),
  gymInterior: u("1571902943202-507ec2618e8f", 1200),
  gymEquipment: u("1540497077202-7c8a3999166f", 1200),
  athlete: u("1517836357463-d25dfeac3438", 1200),
  workoutMan: u("1599058917212-d750089bc07e", 1000),
  womanFit: u("1594381898411-846e7d193883", 1000),
  training: u("1593079831268-3381b0db4a77", 1000),

  // Muscle groups (exercise imagery)
  chest: u("1532029837206-abbe2b7620e3", 700),
  back: u("1605296867304-46d5465a13f1", 700),
  legs: u("1574680096145-d05b474e2155", 700),
  shoulders: u("1532384748853-8f54a8f476e2", 700),
  arms: u("1581009146145-b5ef050c2e1e", 700),
  core: u("1544367567-0f2fcb009e0b", 700),
  cardio: u("1538805060514-97d9cc17730c", 700),
  fullBody: u("1534438327276-14e5300c3a48", 700),

  // Food / recipes
  saladBowl: u("1546069901-ba9599a7e63c", 700),
  veggies: u("1512621776951-a57141f2eefd", 700),
  salmon: u("1467003909585-2f8a72700288", 700),
  chickenRice: u("1565299624946-b28f40a0ae38", 700),
} as const;

// Map a muscle group to its image
export const muscleImage: Record<string, string> = {
  Chest: IMG.chest,
  Back: IMG.back,
  Legs: IMG.legs,
  Shoulders: IMG.shoulders,
  Arms: IMG.arms,
  Core: IMG.core,
  Cardio: IMG.cardio,
  "Full Body": IMG.fullBody,
};
