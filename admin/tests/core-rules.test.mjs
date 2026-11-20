// Admin-core's pure rules: platform settings, targeted notices, the Users filters, chart geometry and the theme.
import test from "node:test";
import assert from "node:assert/strict";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const settings = await importTypeScriptModule("src/components/settings/settings-rules.ts");
const notices = await importTypeScriptModule("src/components/notifications/notice-rules.ts");
const people = await importTypeScriptModule("src/components/users/people-filters.ts");
const charts = await importTypeScriptModule("src/components/console/chart-math.ts");
const theme = await importTypeScriptModule("src/components/theme/theme.ts");
const support = await importTypeScriptModule("src/lib/support-catalog.ts");

const valid = {
  features: { ai_coach: true, home_workout: false, activity: true, subscriptions: true, support: true },
  maintenanceOn: false,
  maintenanceTitle: "",
  maintenanceBody: "",
  startsAt: null,
  endsAt: null,
  supportEmail: "help@example.test",
  instagramUrl: "https://www.instagram.com/fitx/",
};

test("settings: a stored row reads with every switch on unless saved off, and site defaults when empty", () => {
  const empty = settings.parseSettingsRow(null);
  assert.deepEqual(empty.features, { ai_coach: true, home_workout: true, activity: true, subscriptions: true, support: true });
  assert.equal(empty.maintenance, null);
  assert.deepEqual(empty.site, { ...settings.SITE_DEFAULTS });
  const row = settings.parseSettingsRow({ features: { support: false }, maintenance: { title: "Upgrade", body: "Slow tonight", startsAt: "2026-11-21T10:00:00Z" }, site: { supportEmail: "x" }, updated_at: "2026-11-20T00:00:00Z" });
  assert.equal(row.features.support, false);
  assert.deepEqual(row.maintenance, { title: "Upgrade", body: "Slow tonight", startsAt: "2026-11-21T10:00:00.000Z", endsAt: null });
  assert.equal(row.site.supportEmail, settings.SITE_DEFAULTS.supportEmail);
  assert.equal(row.updatedAt, "2026-11-20T00:00:00Z");
});

test("settings: the form is checked as the database checks it", () => {
  const ok = settings.validateSettingsInput(valid);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.features.home_workout, false);
  assert.equal(ok.value.maintenance, null);
  assert.equal(settings.validateSettingsInput({ ...valid, supportEmail: "nope" }).ok, false);
  assert.equal(settings.validateSettingsInput({ ...valid, instagramUrl: "https://instagram.evil.example/x" }).ok, false);
  assert.equal(settings.validateSettingsInput({ ...valid, maintenanceOn: true, maintenanceTitle: "Up", maintenanceBody: "x" }).ok, false);
  assert.equal(settings.validateSettingsInput({ ...valid, maintenanceOn: true, maintenanceTitle: "Upgrade", maintenanceBody: "x", startsAt: undefined }).ok, false);
  assert.equal(settings.validateSettingsInput({ ...valid, maintenanceOn: true, maintenanceTitle: "Upgrade", maintenanceBody: "x", startsAt: "2026-11-21T10:00:00Z", endsAt: "2026-11-21T09:00:00Z" }).ok, false);
  const on = settings.validateSettingsInput({ ...valid, maintenanceOn: true, maintenanceTitle: " Upgrade ", maintenanceBody: "Slow tonight", startsAt: null, endsAt: "2026-11-21T09:00:00Z" });
  assert.deepEqual(on.value.maintenance, { title: "Upgrade", body: "Slow tonight", startsAt: null, endsAt: "2026-11-21T09:00:00Z" });
  assert.equal(settings.maintenanceTiming(on.value.maintenance, Date.parse("2026-11-21T08:00:00Z")), "live");
  assert.equal(settings.maintenanceTiming(on.value.maintenance, Date.parse("2026-11-21T09:00:00Z")), "ended");
  assert.equal(settings.maintenanceTiming(null), "off");
  assert.equal(settings.maintenanceTiming({ title: "a", body: "b", startsAt: "2099-01-01T00:00:00Z", endsAt: null }), "scheduled");
});

test("notices: pasted recipients split into IDs and emails, each once; junk is reported", () => {
  const list = notices.parseRecipients("ASHA@example.test, asha@example.test\n9F1C2B3A-1111-4222-8333-444455556666;not-an-email  ben@example.test");
  assert.deepEqual(list.emails, ["asha@example.test", "ben@example.test"]);
  assert.deepEqual(list.ids, ["9f1c2b3a-1111-4222-8333-444455556666"]);
  assert.deepEqual(list.invalid, ["not-an-email"]);
  assert.deepEqual(notices.parseRecipients(null), { ids: [], emails: [], invalid: [] });
  assert.equal(notices.recipientsFromQuery("9f1c2b3a-1111-4222-8333-444455556666,evil,9f1c2b3a-1111-4222-8333-444455556666"), "9f1c2b3a-1111-4222-8333-444455556666");
  assert.equal(notices.NOTICE_MAX_RECIPIENTS, 500);
});

test("users: filters accept only known values and round-trip through the link", () => {
  const filters = people.parsePeopleFilters({ q: " asha ", status: "suspended", method: "google", plan: "premium", page: "2" });
  assert.deepEqual(filters, { q: "asha", status: "suspended", method: "google", plan: "premium", page: 2 });
  assert.equal(people.peopleHref(filters, { page: 1 }), "/users?q=asha&status=suspended&method=google&plan=premium");
  const junk = people.parsePeopleFilters({ status: "deleted", method: "myspace", plan: "gold", page: "-1" });
  assert.deepEqual(junk, { q: "", status: null, method: null, plan: null, page: 1 });
  assert.equal(people.peopleHref(junk), "/users");
  assert.equal(people.hasFilters(junk), false);
  assert.deepEqual(people.methodLabels(["phone", "google", "email", "google", "github"]), ["Google", "Email", "Phone", "github"]);
  assert.deepEqual(people.selectedIds(["9F1C2B3A-1111-4222-8333-444455556666", "x", 4, "9f1c2b3a-1111-4222-8333-444455556666"]), ["9f1c2b3a-1111-4222-8333-444455556666"]);
  assert.equal(people.BULK_SUSPEND_MAX, 50);
});

test("users: the plan column never shows an unknown as Free", () => {
  assert.equal(people.subscriptionLabel(null, null), null);
  assert.deepEqual(people.subscriptionLabel(null, false), { text: "Free", tone: "neutral" });
  assert.deepEqual(people.subscriptionLabel("active", true), { text: "Premium", tone: "good" });
  assert.deepEqual(people.subscriptionLabel("halted", false), { text: "Payment failed", tone: "warn" });
});

test("charts: bars, sparklines and shares from counts", () => {
  assert.equal(charts.niceCeiling(0), 1);
  assert.equal(charts.niceCeiling(7), 10);
  assert.equal(charts.niceCeiling(140), 200);
  const { bars, max } = charts.barLayout([0, 5, 10], { width: 300, height: 100, gap: 0 });
  assert.equal(max, 10);
  assert.deepEqual(bars.map((bar) => Math.round(bar.height)), [2, 50, 100]);
  assert.equal(bars[2].y, 0);
  assert.equal(charts.sparkPath([], 100, 20), "");
  assert.match(charts.sparkPath([1, 2, 3], 100, 20), /^M2\.0 /);
  const split = charts.shares([{ key: "a", label: "A", value: 3 }, { key: "b", label: "B", value: 1 }, { key: "c", label: "C", value: 0 }]);
  assert.equal(split.total, 4);
  assert.deepEqual(split.parts.map((part) => [part.key, part.share, part.offset]), [["a", 0.75, 0], ["b", 0.25, 0.75]]);
  assert.deepEqual(charts.shares([]), { total: 0, parts: [] });
  assert.equal(charts.percent(0.004), "<1%");
  assert.equal(charts.percent(0.5), "50%");
  assert.equal(charts.halfChange([1, 1, 3, 3]), 4);
  assert.equal(charts.halfChange([1, 2]), null);
});

test("theme and support vocabulary", () => {
  assert.equal(theme.parseAdminTheme("dark"), "dark");
  assert.equal(theme.parseAdminTheme("purple"), "system");
  assert.equal(theme.themeAttribute("system"), undefined);
  assert.equal(theme.themeAttribute("light"), "light");
  assert.ok(support.SUPPORT_CATEGORIES.includes("complaint"));
  for (const category of support.SUPPORT_CATEGORIES) {
    assert.ok(support.SUPPORT_CATEGORY_LABELS[category], category);
    assert.ok(support.SUPPORT_CATEGORY_SHORT[category], category);
  }
  assert.equal(support.isSupportCategory("complaint"), true);
  assert.equal(support.isSupportCategory("billing"), false);
});

test("users: phone numbers read with a plus", () => {
  assert.equal(people.formatPhone("919812345678"), "+919812345678");
  assert.equal(people.formatPhone("+91 98123"), "+9198123");
  assert.equal(people.formatPhone(""), null);
  assert.equal(people.formatPhone(null), null);
});
