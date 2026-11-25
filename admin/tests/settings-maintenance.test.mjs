// Settings' maintenance notice (BUGS.md 76, cross-cutting-10): while "Show to signed-in members" is off, the notice's
// fields were only dimmed to 55% (labels at 2.6:1) but stayed editable, and what was typed there was thrown away on
// save. Now they are really disabled while it is off (Tab skips them, nothing is sent), their labels keep full
// contrast, and a note says why.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const settings = await importTypeScriptModule("src/components/settings/settings-rules.ts");

test("the fields are a fieldset disabled while the switch is off, with a note tied to the switch", async () => {
  const form = await readFile(new URL("../src/components/settings/settings-form.tsx", import.meta.url), "utf8");
  assert.match(form, /const \[maintenanceOn, setMaintenanceOn\] = useState\(defaults\.maintenance\.on\);/);
  assert.match(form, /name="maintenance_on" defaultChecked=\{defaults\.maintenance\.on\} aria-describedby=\{maintenanceOn \? undefined : maintenanceNote\} onChange=\{\(event\) => setMaintenanceOn\(event\.target\.checked\)\}/);
  assert.match(form, /<fieldset key=\{defaults\.updatedAt \?\? "unsaved"\} className=\{`\$\{styles\.maintenanceFields\} stack-form`\} disabled=\{!maintenanceOn\}>/);
  assert.match(form, /\{!maintenanceOn && <p className="field-note" id=\{maintenanceNote\}>Switch it on to write the notice\./);
  for (const name of ["maintenance_title", "maintenance_body", "maintenance_starts", "maintenance_ends"]) {
    const field = form.indexOf(`name="${name}"`);
    assert.ok(field > form.indexOf("disabled={!maintenanceOn}") && field < form.indexOf("</fieldset>", form.indexOf("disabled={!maintenanceOn}")), `${name} is inside the fieldset`);
  }
});

test("nothing is dimmed: no opacity on the fields, and a disabled field still reads at AA", async () => {
  const css = await readFile(new URL("../src/components/settings/settings.module.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /maintenanceFields[^}]*opacity/);
  assert.doesNotMatch(css, /:not\(:has\(input\[name="maintenance_on"\]:checked\)\)/);
  assert.match(css, /\.maintenanceFields:disabled :is\(input, textarea\) \{[^}]*color: var\(--muted\);/);
  // --muted on --surface-soft, light and dark: at least 4.5:1.
  const globals = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const muted = [...globals.matchAll(/--muted: (#[0-9a-f]{6});/g)].map((match) => match[1]);
  const soft = [...globals.matchAll(/--surface-soft: (#[0-9a-f]{6});/g)].map((match) => match[1]);
  assert.equal(muted.length, soft.length);
  muted.forEach((colour, index) => {
    const [light, dark] = [luminance(colour), luminance(soft[index])].sort((a, b) => b - a);
    assert.ok((light + 0.05) / (dark + 0.05) >= 4.5, `${colour} on ${soft[index]}`);
  });
});

test("with the switch off nothing from the fields is kept, so a disabled field loses nothing that would be saved", () => {
  const off = settings.validateSettingsInput({ features: {}, maintenanceOn: false, maintenanceTitle: null, maintenanceBody: null, startsAt: null, endsAt: null, supportEmail: "help@example.test", instagramUrl: "https://www.instagram.com/fitx/" });
  assert.equal(off.ok, true);
  assert.equal(off.value.maintenance, null);
});
