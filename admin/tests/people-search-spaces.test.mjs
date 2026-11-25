// Users search (BUGS.md 69, admin-11): the database matches the search text as one piece (ILIKE '%q%'), so the text
// is normalised first: any run of spaces is one space and the ends are trimmed. "Asha  Local" (two spaces, as pasted)
// and "  Asha   Local " find Asha Local like "Asha Local" does.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fake, resetFakes, rpcCalls, SESSION_STUBS, setTestEnv } from "./helpers/fakes.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const people = await importTypeScriptModule("src/components/users/people-filters.ts");
const data = await importTypeScriptModule("src/lib/data/people.ts", SESSION_STUBS);
const actions = await importTypeScriptModule("src/app/(control)/users/actions.ts", SESSION_STUBS);
const search = await importTypeScriptModule("src/lib/people-search.ts");
const OPERATOR = { id: "00000000-0000-4000-8000-0000000000a1", username: "huntadmin", role: "super_admin", permissions: ["people.view"] };

beforeEach(() => {
  resetFakes();
  setTestEnv();
  fake.operator = OPERATOR;
});

test("any run of spaces inside the search is one space, and the ends are trimmed", () => {
  for (const typed of ["Asha Local", "Asha  Local", "  Asha   Local ", "Asha\tLocal", "Asha  Local", "Asha\n Local"]) {
    assert.equal(people.normalisePeopleQuery(typed), "Asha Local", JSON.stringify(typed));
  }
  assert.equal(people.normalisePeopleQuery("   "), "");
  assert.equal(people.normalisePeopleQuery(`${"a ".repeat(70)}`).length <= 120, true);
  assert.doesNotMatch(people.normalisePeopleQuery(`${"a".repeat(119)}   b`), /\s$/, "never ends on a space after the cut");
});

test("the search form seals the normalised text, and the database gets it as one space", async () => {
  let url = null;
  await actions.searchUsers((() => { const form = new FormData(); form.set("q", "  Asha   Local "); return form; })()).catch((error) => { url = error.url; });
  const token = new URL(url, "https://admin.invalid").searchParams.get("s");
  assert.equal(search.openPeopleSearch(token, OPERATOR.id), "Asha Local");
  fake.handler = () => ({ data: [], error: null });
  await data.searchPeopleFiltered({ q: people.normalisePeopleQuery("Asha  Local"), status: null, method: null, plan: null, page: 1 });
  assert.equal(rpcCalls("fitx_admin_search_users_v2")[0].args.p_query, "Asha Local");
});
