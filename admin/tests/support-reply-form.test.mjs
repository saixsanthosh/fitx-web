// The help request's reply form (the bug 63 mistake in Support): a refused reply used to redirect, which reset the
// form and threw away what the agent had typed. A refusal now comes back beside Send reply, in Support's words, with
// the reply kept (keepTyped); a reply sent goes back with a sealed result (BUGS.md 1).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fake, resetFakes, rpcCalls, SESSION_STUBS, setTestEnv } from "./helpers/fakes.mjs";
import { sealedRedirect } from "./helpers/notices.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const actions = await importTypeScriptModule("src/app/(control)/support/actions.ts", SESSION_STUBS);
const AGENT = { id: "00000000-0000-4000-8000-0000000000c4", username: "agent", role: "support_agent", sessionId: "s1", isRoot: false, permissions: ["support.view", "support.reply"] };
const REQUEST = "29df6037-1222-4497-8b17-82de78e7a09f";
const IDLE = { status: "idle" };

beforeEach(() => {
  resetFakes();
  setTestEnv();
  fake.operator = AGENT;
});

const reply = (body, status = "waiting_on_user") => {
  const form = new FormData();
  form.set("requestId", REQUEST);
  form.set("body", body);
  form.set("status", status);
  return form;
};

async function outcome(promise) {
  try {
    return { state: await promise };
  } catch (error) {
    if (error?.url) return { url: error.url };
    throw error;
  }
}

test("a reply of only spaces, or with a status that is not one, is refused beside the form and sends nothing", async () => {
  assert.deepEqual(await actions.replyToRequest(IDLE, reply("   ")), {
    status: "error", message: "A reply needs 1 to 4000 characters.", fieldErrors: { body: "A reply needs 1 to 4000 characters." },
  });
  assert.deepEqual(Object.keys((await actions.replyToRequest(IDLE, reply("Thanks!", "archived"))).fieldErrors), ["status"]);
  assert.equal(fake.calls.length, 0);
});

test("a database failure comes back to the form (the reply is kept), and is logged", async () => {
  fake.handler = (call) => (call.rpc === "fitx_admin_op_support_reply" ? { data: null, error: { code: "XX000", message: "boom" } } : { data: null, error: null });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  const result = await outcome(actions.replyToRequest(IDLE, reply("A long, careful answer."))).finally(() => { console.error = original; });
  assert.deepEqual(result.state, { status: "error", message: "The change did not complete. The server log has the details.", fieldErrors: undefined });
  assert.ok(errors.some((line) => line.includes("support.reply")));
  fake.handler = (call) => (call.rpc === "fitx_admin_op_support_reply" ? { data: null, error: { code: "42501", message: "permission denied" } } : { data: null, error: null });
  assert.equal((await outcome(actions.replyToRequest(IDLE, reply("Hello")))).state.message, "Your role cannot change help requests.");
});

test("a reply sent, or a request that is gone, goes back with a sealed result", async () => {
  fake.handler = () => ({ data: null, error: null });
  const sent = await outcome(actions.replyToRequest(IDLE, reply("Thanks, fixed now.")));
  assert.deepEqual(sealedRedirect(sent.url, AGENT.id), { path: `/support/${REQUEST}`, notice: { code: "replied", count: null } });
  assert.equal(rpcCalls("fitx_admin_op_support_reply")[0].args.p_body, "Thanks, fixed now.");
  fake.handler = (call) => (call.rpc === "fitx_admin_op_support_reply" ? { data: null, error: { code: "P0002", message: "gone" } } : { data: null, error: null });
  const gone = await outcome(actions.replyToRequest(IDLE, reply("Hello")));
  assert.deepEqual(sealedRedirect(gone.url, AGENT.id), { path: "/support", notice: { code: "not_found", count: null } });
});

test("the page draws the reply form, which keeps what was typed", async () => {
  const page = await readFile(new URL("../src/app/(control)/support/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\{mayReply && <ReplyForm requestId=\{thread\.id\} \/>\}/);
  const form = await readFile(new URL("../src/components/support/reply-form.tsx", import.meta.url), "utf8");
  assert.match(form, /useActionState\(replyToRequest, IDLE\)/);
  assert.match(form, /onSubmit=\{keepTyped\(action\)\}/);
  assert.match(form, /<FormResult /);
});
