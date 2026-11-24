// The policy pages' "Last updated" date (LegalPage): plain British English, day month year, as the rest of FITX
// writes dates, and a new date whenever a policy's text changes, so a member who read the old version can see that it
// did (the privacy page: "The date above shows when this page was last revised").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, ROOT), "utf8");

const PAGES = ["privacy", "cookies", "terms", "refunds"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BRITISH = new RegExp(`^([1-9]|[12][0-9]|3[01]) (${MONTHS.join("|")}) (20[0-9]{2})$`);

/** The date a policy page gives LegalPage, inline or through its `updated` constant. */
function updated(page: (typeof PAGES)[number]): string {
  const source = read(`src/app/(marketing)/${page}/page.tsx`);
  assert.match(source, /<LegalPage title="[^"]+" updated=/, `${page} is a LegalPage`);
  const date = source.match(/<LegalPage title="[^"]+" updated="([^"]+)">/)?.[1] ?? source.match(/^const updated = "([^"]+)";$/m)?.[1];
  assert.ok(date, `${page}: the date is a plain string in the page`);
  return date;
}

/** Midnight UTC of a British-order date. */
function day(text: string): number {
  const [, date, month, year] = text.match(BRITISH) ?? [];
  return Date.UTC(Number(year), MONTHS.indexOf(month), Number(date));
}

test("every policy page shows when it was last revised in British order: day, month, year", () => {
  for (const page of PAGES) assert.match(updated(page), BRITISH, page);
  assert.match(read("src/components/layout/LegalPage.tsx"), /Last updated \{updated\}/);
});

test("the privacy and cookie pages, whose text changed after release 2a, carry a later date than 2a's 24 November 2026", () => {
  // Release 2a (master 71d75b9) showed "November 24, 2026" on both; 2b adds the FITX films section, the films' keys on
  // the device and the account film's cookie text.
  for (const page of ["privacy", "cookies"] as const) assert.ok(day(updated(page)) > Date.UTC(2026, 10, 24), `${page}: ${updated(page)}`);
});
