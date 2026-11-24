// Talks to the running Supabase stand-in from the flows: superuser SQL (service-role-only endpoint) for
// seeding and for checking what the app wrote, and test accounts with random passwords.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const quote = (value) => (value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`);
const textArray = (items) => `${quote(`{${items.map((item) => `"${String(item).replace(/["\\]/g, "\\$&")}"`).join(",")}}`)}::text[]`;

export class Standin {
  constructor(info) {
    this.info = info;
    this.url = info.url;
    this.anonKey = info.anonKey;
    this.serviceRoleKey = info.serviceRoleKey;
  }

  static fromFile(file) {
    return new Standin(JSON.parse(readFileSync(file, "utf8")));
  }

  /** Runs SQL as the superuser; returns the last result's rows as objects. */
  async sql(query) {
    const response = await fetch(`${this.url}/__e2e/sql`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.serviceRoleKey}`, "content-type": "application/json" },
      body: JSON.stringify({ sql: query }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`stand-in SQL failed (${response.status}): ${body.message ?? JSON.stringify(body)}`);
    const last = body.results.filter((result) => result.fields.length).pop();
    if (!last) return [];
    return last.rows.map((row) => Object.fromEntries(last.fields.map((field, index) => [field, row[index]])));
  }

  async one(query) {
    return (await this.sql(query))[0] ?? null;
  }

  newCredentials(name, tag) {
    const stamp = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
    return { name, email: `e2e-${tag}-${stamp}@fitx.test`, password: `Fx-${randomBytes(12).toString("base64url")}` };
  }

  /** Signs up through the stand-in's Auth API, as the sign-up page does. */
  async signUp({ name, email, password }) {
    const response = await fetch(`${this.url}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: this.anonKey, authorization: `Bearer ${this.anonKey}`, "content-type": "application/json" },
      body: JSON.stringify({ email, password, data: { name } }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`sign-up failed: ${body.msg ?? JSON.stringify(body)}`);
    return body.user.id;
  }

  async authToken(grant, body) {
    const response = await fetch(`${this.url}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: { apikey: this.anonKey, authorization: `Bearer ${this.anonKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(`${grant} grant failed: ${json.msg ?? JSON.stringify(json)}`);
    return json;
  }

  /** A fresh session for e-mail and password, as signInWithPassword gets it. */
  passwordSession(email, password) {
    return this.authToken("password", { email, password });
  }

  /**
   * A session whose last sign-in (the access token's AMR timestamp) was `minutesAgo` minutes ago: signs in,
   * backdates the sign-in in the auth schema, then refreshes, as an older session would look after a refresh.
   */
  async staleSession(email, password, minutesAgo) {
    const first = await this.passwordSession(email, password);
    const sessionId = JSON.parse(Buffer.from(first.access_token.split(".")[1], "base64url").toString()).session_id;
    await this.sql(`update auth.mfa_amr_claims set created_at = now() - interval '${Number(minutesAgo)} minutes', updated_at = now() - interval '${Number(minutesAgo)} minutes' where session_id = '${sessionId}';
      update auth.users set last_sign_in_at = now() - interval '${Number(minutesAgo)} minutes' where email = ${quote(email)};`);
    return this.authToken("refresh_token", { refresh_token: first.refresh_token });
  }

  /** The cookies @supabase/ssr keeps a session in (base64url, split into 3180-character chunks when long). */
  sessionCookies(session, appUrl) {
    const name = `sb-${new URL(this.url).hostname.split(".")[0]}-auth-token`;
    const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
    const host = new URL(appUrl).hostname;
    const chunks = value.length <= 3180 ? [value] : value.match(/.{1,3180}/g);
    const base = { domain: host, path: "/", sameSite: "Lax", secure: false, httpOnly: false, expires: Math.floor(Date.now() / 1000) + 3600 * 24 * 30 };
    return chunks.length === 1 ? [{ ...base, name, value }] : chunks.map((chunk, index) => ({ ...base, name: `${name}.${index}`, value: chunk }));
  }

  /** Uploads bytes to Storage as the signed-in user of `session` (bucket policies apply). */
  async upload(session, bucket, objectPath, bytes, contentType) {
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", new Blob([bytes], { type: contentType }), objectPath.split("/").pop());
    const response = await fetch(`${this.url}/storage/v1/object/${bucket}/${objectPath}`, {
      method: "POST",
      headers: { apikey: this.anonKey, authorization: `Bearer ${session.access_token}`, "x-upsert": "false" },
      body: form,
    });
    const json = await response.json();
    if (!response.ok) throw new Error(`upload failed: ${json.message ?? JSON.stringify(json)}`);
    return json;
  }

  /**
   * An account that has finished onboarding, with the rows onboarding writes (profile, preferences, home
   * equipment, a starting weigh-in). `introSeen` marks the one-time film as already played. Like onboarding, it saves a
   * date of birth that gives `profile.age` (Explore's age rules read only the date: O1 (a)); pass
   * `profile.date_of_birth` to choose one, or `null` for an account with no date of birth.
   */
  async createAccount({ name = "E2E Tester", tag = "user", profile = {}, prefs = {}, homeEquipment = ["dumbbell", "resistance_band", "bench"], introSeen = true } = {}) {
    const credentials = this.newCredentials(name, tag);
    const id = await this.signUp(credentials);
    const p = { age: 30, gender: "female", height: 165, weight: 72, target_weight: 66, ...profile };
    // 40 days past the birthday, so the age the date gives is p.age (profiles.age follows the date of birth).
    const birthDate = "date_of_birth" in profile
      ? (profile.date_of_birth === null ? "null" : `${quote(profile.date_of_birth)}::date`)
      : (p.age === null || p.age === undefined ? "null" : `((current_date - make_interval(years => ${Number(p.age)}))::date - 40)`);
    const q = {
      workout_location: "both", fitness_level: "intermediate", primary_goal: "fat_loss", workouts_per_week: 4,
      session_duration_minutes: 45, workout_split: "full_body", activity_level: "moderate", diet_type: "non_vegetarian",
      dietary_preferences: [], allergies: [], meals_per_day: 3, timezone: "Asia/Kolkata", height_unit: "cm", weight_unit: "kg",
      equipment: homeEquipment, ...prefs,
    };
    await this.sql(`
      update public.profiles set name = ${quote(name)}, age = ${Number(p.age)}, date_of_birth = ${birthDate}, gender = ${quote(p.gender)}, height = ${Number(p.height)},
        weight = ${Number(p.weight)}, target_weight = ${p.target_weight === null ? "null" : Number(p.target_weight)}, onboarded = true,
        intro_completed_at = ${introSeen ? "now()" : "null"} where id = ${quote(id)};
      insert into public.user_preferences (user_id, workout_location, equipment, fitness_level, primary_goal, workouts_per_week, session_duration_minutes,
        workout_split, activity_level, dietary_preferences, allergies, meals_per_day, timezone, diet_type, height_unit, weight_unit)
      values (${quote(id)}, ${quote(q.workout_location)}, ${textArray(q.equipment)}, ${quote(q.fitness_level)}, ${quote(q.primary_goal)}, ${Number(q.workouts_per_week)},
        ${Number(q.session_duration_minutes)}, ${quote(q.workout_split)}, ${quote(q.activity_level)}, ${textArray(q.dietary_preferences)}, ${textArray(q.allergies)},
        ${Number(q.meals_per_day)}, ${quote(q.timezone)}, ${quote(q.diet_type)}, ${quote(q.height_unit)}, ${quote(q.weight_unit)})
      on conflict (user_id) do update set workout_location = excluded.workout_location, equipment = excluded.equipment, fitness_level = excluded.fitness_level,
        primary_goal = excluded.primary_goal, workouts_per_week = excluded.workouts_per_week, session_duration_minutes = excluded.session_duration_minutes,
        workout_split = excluded.workout_split, activity_level = excluded.activity_level, dietary_preferences = excluded.dietary_preferences,
        allergies = excluded.allergies, meals_per_day = excluded.meals_per_day, timezone = excluded.timezone, diet_type = excluded.diet_type,
        height_unit = excluded.height_unit, weight_unit = excluded.weight_unit;
      insert into public.user_equipment_profiles (user_id, context, equipment_keys) values (${quote(id)}, 'home', ${textArray(homeEquipment)})
        on conflict (user_id, context) do update set equipment_keys = excluded.equipment_keys;
      insert into public.body_metrics (user_id, date, weight, note) values (${quote(id)}, (now() at time zone 'Asia/Kolkata')::date, ${Number(p.weight)}, 'Starting weight');`);
    return { ...credentials, id };
  }
}
