import test from "node:test";
import assert from "node:assert/strict";
import {
  columnList,
  hasValuesIn,
  isMissingColumnError,
  missingColumnFromError,
  omitColumns,
  payloadFor,
  withOptionalColumns,
} from "../../src/lib/domain/schema-fallback.ts";

// Error bodies exactly as PostgREST returns them (supabase-js passes them through as `error`).
const missingReadColumn = {
  code: "42703",
  details: null,
  hint: 'Perhaps you meant to reference the column "workout_plan_exercises.target_sets".',
  message: "column workout_plan_exercises.target_weight_kg does not exist",
};
const missingWriteColumn = {
  code: "PGRST204",
  details: null,
  hint: null,
  message: "Could not find the 'target_weight_kg' column of 'workout_plan_exercises' in the schema cache",
};
const networkFailure = { code: "", details: "TypeError: Failed to fetch", hint: "", message: "TypeError: Failed to fetch" };

const TARGETS = ["target_weight_kg", "target_duration_seconds"];

/**
 * A small stand-in for PostgREST: it knows which columns exist, rejects unknown
 * payload keys with PGRST204 and unknown selected or filtered columns with 42703,
 * and otherwise stores and returns rows. Like supabase-js, a bulk insert lists the
 * keys of every row as its columns, so a key set to undefined still counts.
 */
function createFakeDatabase(schema) {
  const rows = Object.fromEntries(Object.keys(schema).map((table) => [table, []]));
  const requests = [];
  let nextId = 1;
  let failNextWith = null;

  function reject(error) { return { data: null, error, count: null, status: 400, statusText: "Bad Request" }; }
  function project(row, list) {
    if (!list) return null;
    return Object.fromEntries(list.split(",").map((column) => [column, row[column] ?? null]));
  }

  function execute(request) {
    requests.push({ table: request.table, method: request.method, payload: request.payload, select: request.selectList });
    if (failNextWith) { const error = failNextWith; failNextWith = null; return { data: null, error, count: null, status: 0, statusText: "" }; }
    const known = new Set(schema[request.table]);
    if (request.payload) {
      const payloadRows = Array.isArray(request.payload) ? request.payload : [request.payload];
      const keys = [...new Set(payloadRows.flatMap((row) => Object.keys(row)))];
      const unknown = keys.find((key) => !known.has(key));
      if (unknown) return reject({ code: "PGRST204", details: null, hint: null, message: `Could not find the '${unknown}' column of '${request.table}' in the schema cache` });
    }
    const referenced = [...(request.selectList ? request.selectList.split(",") : []), ...request.filters.map(([column]) => column)];
    const unknownRead = referenced.find((column) => !known.has(column));
    if (unknownRead) return reject({ code: "42703", details: null, hint: null, message: `column ${request.table}.${unknownRead} does not exist` });

    const table = rows[request.table];
    const matches = (row) => request.filters.every(([column, value]) => row[column] === value);
    if (request.method === "POST") {
      const created = (Array.isArray(request.payload) ? request.payload : [request.payload]).map((row) => ({ id: `row-${nextId++}`, ...row }));
      table.push(...created);
      const data = request.selectList ? created.map((row) => project(row, request.selectList)) : null;
      return { data, error: null, count: null, status: 201, statusText: "Created" };
    }
    if (request.method === "PATCH") {
      const changed = table.filter(matches);
      for (const row of changed) Object.assign(row, request.payload);
      const data = request.selectList ? changed.map((row) => project(row, request.selectList)) : null;
      return { data, error: null, count: null, status: 200, statusText: "OK" };
    }
    return { data: table.filter(matches).map((row) => project(row, request.selectList)), error: null, count: null, status: 200, statusText: "OK" };
  }

  class FakeRequest {
    constructor(table, method, payload) { this.table = table; this.method = method; this.payload = payload; this.selectList = null; this.filters = []; }
    select(list) { this.selectList = list; return this; }
    eq(column, value) { this.filters.push([column, value]); return this; }
    then(resolve, reject) { return Promise.resolve().then(() => execute(this)).then(resolve, reject); }
  }

  return {
    rows,
    requests,
    failNextRequestWith(error) { failNextWith = error; },
    from(table) {
      return {
        select: (list) => new FakeRequest(table, "GET", null).select(list),
        insert: (payload) => new FakeRequest(table, "POST", payload),
        update: (payload) => new FakeRequest(table, "PATCH", payload),
      };
    },
  };
}

const legacySchema = {
  workout_plan_exercises: ["id", "user_id", "plan_id", "exercise_id", "exercise_name", "sort_order", "target_sets", "reps_min", "reps_max", "rest_seconds"],
  workout_sets: ["id", "user_id", "session_exercise_id", "set_number", "target_reps", "reps", "weight_kg", "completed_at"],
};
const migratedSchema = {
  workout_plan_exercises: [...legacySchema.workout_plan_exercises, ...TARGETS],
  workout_sets: [...legacySchema.workout_sets, "duration_seconds"],
};

test("reads the column and table from a Postgres 42703 error", () => {
  assert.deepEqual(missingColumnFromError(missingReadColumn), { column: "target_weight_kg", table: "workout_plan_exercises" });
  assert.deepEqual(missingColumnFromError({ code: "42703", message: 'column "duration_seconds" does not exist' }), { column: "duration_seconds", table: null });
  assert.deepEqual(
    missingColumnFromError({ code: "42703", message: 'column "target_duration_seconds" of relation "workout_session_exercises" does not exist' }),
    { column: "target_duration_seconds", table: "workout_session_exercises" },
  );
  assert.deepEqual(missingColumnFromError({ code: "42703", message: "column public.workout_sets.duration_seconds does not exist" }), { column: "duration_seconds", table: "workout_sets" });
});

test("reads the column and table from a PostgREST PGRST204 error", () => {
  assert.deepEqual(missingColumnFromError(missingWriteColumn), { column: "target_weight_kg", table: "workout_plan_exercises" });
});

test("a missing-column code without a recognisable message still counts, with no column named", () => {
  assert.deepEqual(missingColumnFromError({ code: "42703", message: 'record "new" has no field "paused_at"' }), { column: null, table: null });
  assert.deepEqual(missingColumnFromError({ code: "PGRST204", message: "" }), { column: null, table: null });
});

test("a missing-column message without a code is still recognised", () => {
  assert.deepEqual(missingColumnFromError({ message: "column workout_sets.duration_seconds does not exist" }), { column: "duration_seconds", table: "workout_sets" });
});

test("other failures are not treated as missing columns", () => {
  const others = [
    networkFailure,
    { code: "42P01", details: null, hint: null, message: 'relation "public.workout_sets" does not exist' },
    { code: "23514", details: null, hint: null, message: 'new row for relation "workout_sets" violates check constraint "workout_sets_duration_seconds_check"' },
    { code: "42501", details: null, hint: null, message: "permission denied for table workout_sets" },
    { code: "PGRST116", details: "Results contain 2 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" },
    { code: "P0001", details: null, hint: null, message: "column x does not exist" },
    { message: "" },
    null,
    undefined,
    "column x does not exist",
  ];
  for (const error of others) {
    assert.equal(missingColumnFromError(error), null, JSON.stringify(error));
    assert.equal(isMissingColumnError(error, TARGETS), false, JSON.stringify(error));
  }
});

test("isMissingColumnError only accepts the optional columns it is given", () => {
  assert.equal(isMissingColumnError(missingReadColumn), true);
  assert.equal(isMissingColumnError(missingReadColumn, TARGETS), true);
  assert.equal(isMissingColumnError(missingWriteColumn, ["TARGET_WEIGHT_KG"]), true);
  assert.equal(isMissingColumnError({ code: "42703", message: "column workout_plan_exercises.exercise_name does not exist" }, TARGETS), false);
  assert.equal(isMissingColumnError({ code: "42703", message: "unexpected wording" }, TARGETS), true);
});

test("a successful request runs once, with the optional columns", async () => {
  const db = createFakeDatabase(migratedSchema);
  db.rows.workout_plan_exercises.push({ id: "a", plan_id: "p1", exercise_name: "Goblet Squat", target_sets: 3, target_weight_kg: 24, target_duration_seconds: null });
  const calls = [];
  const outcome = await withOptionalColumns(TARGETS, (include) => {
    calls.push(include);
    return db.from("workout_plan_exercises").select(columnList(["id", "exercise_name", "target_sets"], TARGETS, include)).eq("plan_id", "p1");
  });
  assert.deepEqual(calls, [true]);
  assert.equal(outcome.includedOptional, true);
  assert.equal(outcome.missing, null);
  assert.equal(outcome.result.error, null);
  assert.deepEqual(outcome.result.data, [{ id: "a", exercise_name: "Goblet Squat", target_sets: 3, target_weight_kg: 24, target_duration_seconds: null }]);
});

test("a read retries without the optional columns when the database lacks them", async () => {
  const db = createFakeDatabase(legacySchema);
  db.rows.workout_plan_exercises.push({ id: "a", plan_id: "p1", exercise_name: "Goblet Squat", target_sets: 3 });
  const calls = [];
  const outcome = await withOptionalColumns(TARGETS, (include) => {
    calls.push(include);
    return db.from("workout_plan_exercises").select(columnList(["id", "exercise_name", "target_sets"], TARGETS, include)).eq("plan_id", "p1");
  });
  assert.deepEqual(calls, [true, false]);
  assert.equal(outcome.includedOptional, false);
  assert.deepEqual(outcome.missing, { column: "target_weight_kg", table: "workout_plan_exercises" });
  assert.equal(outcome.result.error, null);
  assert.deepEqual(outcome.result.data, [{ id: "a", exercise_name: "Goblet Squat", target_sets: 3 }]);
  assert.deepEqual(db.requests.map((request) => request.select), ["id,exercise_name,target_sets,target_weight_kg,target_duration_seconds", "id,exercise_name,target_sets"]);
});

test("a bulk insert retries without the optional columns and keeps every other value", async () => {
  const db = createFakeDatabase(legacySchema);
  const planRows = [
    { user_id: "u1", plan_id: "p1", exercise_id: "goblet-squat", exercise_name: "Goblet Squat", sort_order: 0, target_sets: 4, reps_min: 6, reps_max: 8, rest_seconds: 120, target_weight_kg: 24, target_duration_seconds: null },
    { user_id: "u1", plan_id: "p1", exercise_id: "front-plank", exercise_name: "Front Plank", sort_order: 1, target_sets: 3, reps_min: 1, reps_max: 1, rest_seconds: 60, target_weight_kg: null, target_duration_seconds: 45 },
  ];
  const outcome = await withOptionalColumns(TARGETS, (include) =>
    db.from("workout_plan_exercises").insert(planRows.map((row) => payloadFor(row, TARGETS, include))).select(columnList(["id", "sort_order"], TARGETS, include)),
  );
  assert.equal(outcome.includedOptional, false);
  assert.deepEqual(outcome.missing, { column: "target_weight_kg", table: "workout_plan_exercises" });
  assert.equal(outcome.result.error, null);
  assert.equal(db.requests.length, 2);
  assert.equal(db.requests[0].payload[0].target_weight_kg, 24, "the first attempt sends the targets");
  const stored = db.rows.workout_plan_exercises;
  assert.equal(stored.length, 2, "the failed attempt stored nothing and the retry stored both rows once");
  for (const [index, row] of stored.entries()) {
    const { id, ...values } = row;
    assert.ok(id);
    assert.deepEqual(values, omitColumns(planRows[index], TARGETS));
  }
  assert.deepEqual(outcome.result.data.map((row) => row.sort_order), [0, 1]);
  assert.equal(planRows[0].target_weight_kg, 24, "the caller's rows are not modified");
});

test("an update retries without the optional column and still saves the set", async () => {
  const db = createFakeDatabase(legacySchema);
  db.rows.workout_sets.push({ id: "set-1", user_id: "u1", session_exercise_id: "se-1", set_number: 1, target_reps: 10, reps: null, weight_kg: 0, completed_at: null });
  const patch = { weight_kg: 32.5, reps: 10, duration_seconds: null, completed_at: "2026-11-16T18:20:00.000Z" };
  const outcome = await withOptionalColumns(["duration_seconds"], (include) =>
    db.from("workout_sets").update(payloadFor(patch, ["duration_seconds"], include)).eq("id", "set-1").eq("user_id", "u1").select("id"),
  );
  assert.equal(outcome.includedOptional, false);
  assert.equal(outcome.result.error, null);
  assert.deepEqual(outcome.result.data, [{ id: "set-1" }]);
  assert.deepEqual(db.rows.workout_sets[0], { id: "set-1", user_id: "u1", session_exercise_id: "se-1", set_number: 1, target_reps: 10, reps: 10, weight_kg: 32.5, completed_at: "2026-11-16T18:20:00.000Z" });
});

test("an insert into a migrated database keeps the optional values", async () => {
  const db = createFakeDatabase(migratedSchema);
  const outcome = await withOptionalColumns(["duration_seconds"], (include) =>
    db.from("workout_sets").insert(payloadFor({ user_id: "u1", session_exercise_id: "se-1", set_number: 1, weight_kg: 0, duration_seconds: 45 }, ["duration_seconds"], include)).select(columnList(["id", "set_number"], ["duration_seconds"], include)),
  );
  assert.equal(outcome.includedOptional, true);
  assert.equal(db.requests.length, 1);
  assert.equal(db.rows.workout_sets[0].duration_seconds, 45);
  assert.deepEqual(outcome.result.data, [{ id: db.rows.workout_sets[0].id, set_number: 1, duration_seconds: 45 }]);
});

test("setting an optional key to undefined is not enough: the key has to be removed", async () => {
  const db = createFakeDatabase(legacySchema);
  const row = { user_id: "u1", session_exercise_id: "se-1", set_number: 1, weight_kg: 0, duration_seconds: undefined };
  const undefinedKey = await db.from("workout_sets").insert([row]);
  assert.equal(undefinedKey.error?.code, "PGRST204");
  const removedKey = await db.from("workout_sets").insert([omitColumns(row, ["duration_seconds"])]);
  assert.equal(removedKey.error, null);
});

test("a missing column that is not optional is returned without a retry", async () => {
  const db = createFakeDatabase({ workout_plan_exercises: ["id", "plan_id", ...TARGETS] });
  const calls = [];
  const outcome = await withOptionalColumns(TARGETS, (include) => {
    calls.push(include);
    return db.from("workout_plan_exercises").select(columnList(["id", "exercise_name"], TARGETS, include)).eq("plan_id", "p1");
  });
  assert.deepEqual(calls, [true]);
  assert.equal(outcome.includedOptional, true);
  assert.equal(outcome.result.error.code, "42703");
  assert.match(outcome.result.error.message, /exercise_name/);
});

test("a network failure is returned without a retry", async () => {
  const db = createFakeDatabase(legacySchema);
  db.failNextRequestWith(networkFailure);
  const calls = [];
  const outcome = await withOptionalColumns(TARGETS, (include) => {
    calls.push(include);
    return db.from("workout_plan_exercises").insert(payloadFor({ plan_id: "p1", exercise_name: "Row", target_weight_kg: 40 }, TARGETS, include));
  });
  assert.deepEqual(calls, [true]);
  assert.equal(outcome.includedOptional, true);
  assert.equal(outcome.missing, null);
  assert.deepEqual(outcome.result.error, networkFailure);
  assert.equal(db.rows.workout_plan_exercises.length, 0);
});

test("when the retry fails too, its error is returned and the columns are still reported missing", async () => {
  const db = createFakeDatabase(legacySchema);
  const outcome = await withOptionalColumns(TARGETS, (include) => {
    if (!include) db.failNextRequestWith(networkFailure);
    return db.from("workout_plan_exercises").insert(payloadFor({ plan_id: "p1", exercise_name: "Row", target_weight_kg: 40 }, TARGETS, include));
  });
  assert.equal(outcome.includedOptional, false);
  assert.deepEqual(outcome.missing, { column: "target_weight_kg", table: "workout_plan_exercises" });
  assert.deepEqual(outcome.result.error, networkFailure);
  assert.equal(db.rows.workout_plan_exercises.length, 0);
});

test("includeOptional: false skips straight to the reduced request", async () => {
  const db = createFakeDatabase(legacySchema);
  const calls = [];
  const outcome = await withOptionalColumns(TARGETS, (include) => {
    calls.push(include);
    return db.from("workout_plan_exercises").select(columnList(["id"], TARGETS, include));
  }, { includeOptional: false });
  assert.deepEqual(calls, [false]);
  assert.equal(outcome.includedOptional, false);
  assert.equal(outcome.missing, null);
  assert.equal(outcome.result.error, null);
  assert.equal(db.requests.length, 1);
});

test("columnList, omitColumns, payloadFor and hasValuesIn", () => {
  assert.equal(columnList(["id", "name"], TARGETS, true), "id,name,target_weight_kg,target_duration_seconds");
  assert.equal(columnList(["id", "name"], TARGETS, false), "id,name");
  const row = { id: "x", target_weight_kg: 20, target_duration_seconds: null };
  assert.deepEqual(omitColumns(row, TARGETS), { id: "x" });
  assert.deepEqual(row, { id: "x", target_weight_kg: 20, target_duration_seconds: null });
  assert.equal(payloadFor(row, TARGETS, true), row);
  assert.deepEqual(payloadFor(row, TARGETS, false), { id: "x" });
  assert.equal(hasValuesIn([row], TARGETS), true);
  assert.equal(hasValuesIn([{ target_weight_kg: 0 }], TARGETS), true, "zero is a value");
  assert.equal(hasValuesIn([{ id: "y", target_weight_kg: null }, { id: "z" }], TARGETS), false);
});
