/**
 * Decisions of the Log food sheet, kept out of the page so `node --test` can check them: the amount check shown next
 * to the amount (only while it is wrong).
 */

/** The amount's problem once Add to log was pressed, or null: it goes away as soon as the amount is right. */
export function amountProblem(grams: number): string | null {
  return Number.isFinite(grams) && grams >= 1 && grams <= 5000 ? null : "Enter an amount that comes to between 1 and 5,000 grams.";
}
