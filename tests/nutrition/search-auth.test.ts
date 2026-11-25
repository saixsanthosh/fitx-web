// From the bug hunt's Nutrition notes (seen once, not reproduced): a "2 dal" search answered "Sign in to search food."
// to a signed-in member when the server's sign-in check couldn't reach the auth service. An outage now says so (503);
// only a missing or ended session says "Sign in".
import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthRetryableFetchError, AuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";
import { searchFoods, type FoodSearchServices } from "@/lib/food/search-route";

const services = { localFoods: [], stapleFoods: [], usdaKey: "" } as unknown as FoodSearchServices;
const client = (error: unknown) => ({ auth: { getUser: async () => ({ data: { user: null }, error }) } }) as unknown as SupabaseClient;
const ask = async (error: unknown) => {
  const response = await searchFoods(new Request("http://localhost/api/foods/search?q=2%20dal"), client(error), services);
  return { status: response.status, body: (await response.json()) as { error: string } };
};

test("a sign-in check that couldn't be made is not reported as signed out", async () => {
  const outage = await ask(new AuthRetryableFetchError("fetch failed", 0));
  assert.equal(outage.status, 503);
  assert.match(outage.body.error, /couldn't be checked just now/);
  assert.equal((await ask({ name: "AuthApiError", status: 502, message: "Bad gateway" })).status, 503);
  const signedOut = await ask(new AuthSessionMissingError());
  assert.deepEqual(signedOut, { status: 401, body: { error: "Sign in to search food." } });
  assert.equal((await searchFoods(new Request("http://localhost/api/foods/search?q=dal"), null, services)).status, 401);
});
