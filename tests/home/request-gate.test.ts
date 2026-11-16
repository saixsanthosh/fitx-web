import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequestGate } from "@/lib/domain/request-gate";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("only the newest of two overlapping loads applies, whatever order they finish in", async () => {
  const gate = createRequestGate();
  const applied: string[] = [];
  const load = async (week: string, response: Promise<string>) => {
    const ticket = gate.begin();
    const items = await response;
    if (gate.isCurrent(ticket)) applied.push(`${week}:${items}`);
  };
  const nextWeek = deferred<string>();
  const weekAfter = deferred<string>();
  const first = load("W+1", nextWeek.promise);
  const second = load("W+2", weekAfter.promise);
  weekAfter.resolve("items of W+2");
  await second;
  nextWeek.resolve("items of W+1");
  await first;
  assert.deepEqual(applied, ["W+2:items of W+2"], "the late W+1 answer is dropped");
});

test("a reload after a settled load is current again", async () => {
  const gate = createRequestGate();
  const ticket = gate.begin();
  assert.equal(gate.isCurrent(ticket), true);
  const next = gate.begin();
  assert.equal(gate.isCurrent(ticket), false);
  assert.equal(gate.isCurrent(next), true);
});
