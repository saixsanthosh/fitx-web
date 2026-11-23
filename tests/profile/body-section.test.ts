import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { birthDateEdit } from "@/lib/domain/profile-options";
import { changedFields } from "@/lib/domain/user-context";

// Profile > Body, once profiles.date_of_birth exists (migration #41). The .tsx section cannot be loaded here, so its
// patch is rebuilt from the same helpers and its wiring is checked in its source.

const ROOT = new URL("../../", import.meta.url);
const source = readFileSync(new URL("src/app/(dashboard)/profile/ProfileSections.tsx", ROOT), "utf8");
const body = source.slice(source.indexOf("export function BodySection"), source.indexOf("export function GoalSection"));

describe("Profile > Body keeps the stored age of a member without a birth date", () => {
  test("a member aged 35 with no birth date who changes only their height keeps their age", () => {
    const stored = { age: 35, date_of_birth: null, gender: "male", height: 175, target_weight: null };
    const birth = birthDateEdit({ age: stored.age, date_of_birth: stored.date_of_birth }, "", new Date(2026, 10, 20));
    const patch = {
      ...changedFields(
        { gender: stored.gender, height: stored.height, target_weight: stored.target_weight },
        { gender: stored.gender, height: 180, target_weight: stored.target_weight },
      ),
      ...birth.patch,
    };
    assert.deepEqual(patch, { height: 180 });
    assert.equal(birth.age, 35);
  });

  test("the section builds the age and birth date patch with birthDateEdit, never age through changedFields", () => {
    assert.match(body, /birthDateEdit\(\{ age: profile\?\.age \?\? null, date_of_birth: profile\?\.date_of_birth \?\? null \}, draft\.birthDate\)/);
    assert.match(body, /\.\.\.\(v3 \? birth\.patch : changedFields\(\{ age: profile\?\.age \?\? null \}, \{ age: typedAge \}\)\)/);
    const generic = body.slice(body.indexOf("const profilePatch"), body.indexOf("// A changed birth date"));
    assert.doesNotMatch(generic, /\bage\b/);
  });

  test("the empty birth date field shows the age on file", () => {
    assert.match(body, /Age on file: \{profile\.age\} years\./);
  });

  test("a saved birth date is shown read-only with the support line; a refused change keeps the saved one", () => {
    assert.match(body, /\{v3 && profile\?\.date_of_birth \? \(\s*\/\/[^\n]*\n\s*<SavedBirthDate value=\{profile\.date_of_birth\} \/>/);
    assert.match(body, /You can add it once\. To change it later, ask FITX support\./);
    assert.match(body, /if \(isBirthDateLocked\(saved\.error\)\) \{\s*const kept = await loadBirthDate\(supabase, data\.userId\);\s*if \(kept\) setDraft\(\(current\) => \(\{ \.\.\.current, birthDate: kept \}\)\);\s*return failed\(setSaving, setError, BIRTH_DATE_SAVED_ERROR\);/);
  });
});

describe("Profile > Body opens from the saved values however it is opened", () => {
  test("the draft, errors and error reset whenever editing turns on, not only from the Edit button", () => {
    assert.match(body, /if \(openedFor !== editing\) \{\s*setOpenedFor\(editing\);\s*if \(editing\) \{\s*setDraft\(original\);\s*setErrors\(\{\}\);\s*setError\(""\);/);
    assert.match(body, /onEdit=\{onEdit\}/);
  });

  test("the targets card's Add body details goes through the same open path", () => {
    const view = readFileSync(new URL("src/app/(dashboard)/profile/ProfileView.tsx", ROOT), "utf8");
    assert.match(view, /onEditBody=\{\(\) => \{ open\("body"\);/);
    assert.match(view, /<BodySection \{\.\.\.sectionProps\("body"\)\} \/>/);
  });
});
