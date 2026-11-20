// The Help page and the app banner keep the names other flows rely on, offer complaints only when the database
// takes them, and show what FITX Admin sends: maintenance notices, notices to one account and announcements.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { helpCategories, SUPPORT_CATEGORIES, validateSupportRequest } from "@/components/support/support-rules";

const read = (file: string) => readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");

test("complaints are offered once the database accepts them, and the request rules take them", () => {
  assert.deepEqual([...helpCategories(true)], [...SUPPORT_CATEGORIES]);
  assert.equal(helpCategories(false).includes("complaint"), false);
  assert.equal(helpCategories(false).length, SUPPORT_CATEGORIES.length - 1);
  assert.equal(validateSupportRequest({ category: "complaint", subject: "Charged twice", body: "I was charged twice this month." }).ok, true);
});

test("the Help page keeps its heading, form names and contact details from platform settings", () => {
  const page = read("app/(dashboard)/help/page.tsx");
  assert.match(page, /title="Help and feedback"/);
  assert.match(page, /loadPlatformSettings\(\)/);
  assert.match(page, /helpCategories\(platform\.source === "database"\)/);
  assert.match(page, /mailto:\$\{email\}/);
  const form = read("components/support/SupportForm.tsx");
  for (const name of ["What is it about?", "Subject", "Message", "Send message", 'aria-labelledby="help-form-title"']) assert.ok(form.includes(name), name);
  const threads = read("components/support/SupportThreads.tsx");
  for (const name of ["Reply", "Send reply", "Your messages"]) assert.ok(threads.includes(name), name);
});

test("the banner keeps the Announcement region and adds maintenance and personal notices under other names", () => {
  const banner = read("components/announcements/AnnouncementBanner.tsx");
  assert.match(banner, /export function AnnouncementBanner\(\)/);
  assert.match(banner, /label="Announcement"/);
  assert.match(banner, /dismissLabel="Dismiss announcement"/);
  assert.match(banner, /label="Maintenance"/);
  assert.match(banner, /label="Message from FITX"/);
  assert.match(banner, /from\("member_notifications"\)\.select\("id,title,body,tone,link_url,link_label"\)\.is\("dismissed_at", null\)/);
  assert.match(banner, /from\("platform_settings"\)\.select\("maintenance"\)/);
  assert.match(banner, /isMaintenanceLive\(parsed\)/);
});
