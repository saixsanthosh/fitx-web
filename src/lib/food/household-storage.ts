/**
 * The member's own katori, bowl and glass sizes, kept in this browser only (localStorage): they are a convenience
 * for turning a bowl into grams, not health data, and keeping them here needs no database change. Every read and
 * write is wrapped, because storage can be blocked or empty (private windows, cleared site data).
 */
import { HOUSEHOLD_ML_RANGE, type HouseholdMl, type Vessel } from "@/lib/domain/food-query";

const KEY = "fitx.household-measures.v1";
const VESSELS: Vessel[] = ["katori", "bowl", "glass"];

/** Keeps only valid sizes (a number of millilitres within the allowed range) for the three vessels. */
export function cleanHousehold(raw: unknown): HouseholdMl {
  const object = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: HouseholdMl = {};
  for (const vessel of VESSELS) {
    const value = Number(object[vessel]);
    if (Number.isFinite(value) && value >= HOUSEHOLD_ML_RANGE.min && value <= HOUSEHOLD_ML_RANGE.max) out[vessel] = Math.round(value);
  }
  return out;
}

export function loadHousehold(): HouseholdMl {
  try {
    return cleanHousehold(JSON.parse(window.localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return {};
  }
}

export function saveHousehold(sizes: HouseholdMl): boolean {
  try {
    const clean = cleanHousehold(sizes);
    if (Object.keys(clean).length) window.localStorage.setItem(KEY, JSON.stringify(clean));
    else window.localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
