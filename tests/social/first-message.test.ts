import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { firstMessageNote, messageErrorText } from "@/lib/social/messages";
import { SocialError, toSocialError } from "@/lib/social/errors";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const refused = (hint: string) => toSocialError({ code: "P0001", message: "social_dm_not_allowed", hint });

// Bug 19 (explore-2): the sheet promised "this goes to their requests", then the send was refused with
// "This member does not take messages from you.", which read like a personal block; a teen's refusal looked the same.
test("before sending, the sheet never promises Requests: it says what happens if the member takes messages from you", () => {
  const note = firstMessageNote("tara.shah");
  assert.equal(note, "If @tara.shah takes messages from you, it goes to their inbox, or to their requests if they do not follow you.");
  assert.doesNotMatch(note, /^If @tara\.shah does not follow you, this goes to their requests/, "the old unconditional promise is gone");
});

test("a refused first message says what the sender can do, from what the sender knows (their own follow)", () => {
  assert.equal(messageErrorText(refused("policy"), { username: "ben.okafor", following: "none" }),
    "@ben.okafor is not taking messages from you. If you follow them first, you can try again.");
  assert.equal(messageErrorText(refused("policy"), { username: "ben.okafor", following: "pending" }),
    "@ben.okafor is not taking messages from you. Once they accept your follow request, you can try again.");
  assert.equal(messageErrorText(refused("policy"), { username: "ben.okafor", following: "accepted" }),
    "@ben.okafor is not taking messages from you right now.", "following already: no advice that cannot help");
  assert.equal(messageErrorText(refused("policy"), { username: "ben.okafor" }),
    "@ben.okafor is not taking messages from you. If you do not follow them yet, follow them first, then try again.", "picked from search: not known");
  assert.equal(messageErrorText(refused("policy")),
    "This member is not taking messages from you. If you do not follow them yet, follow them first, then try again.");
});

test("a teen's refusal ('age') reads exactly like a setting's ('policy'): nothing reveals an age band or a setting", () => {
  for (const following of ["none", "pending", "accepted", null] as const) {
    const context = { username: "tara.shah", following };
    const age = messageErrorText(refused("age"), context);
    assert.equal(age, messageErrorText(refused("policy"), context), String(following));
    assert.doesNotMatch(age, /\b(age|aged|teen|18|adult|under|setting|followers only|blocked)\b/i, String(following));
  }
  // Ben followed 15-year-old Tara and was refused ("age"): he reads the same words as for an adult who takes no messages.
  assert.equal(messageErrorText(refused("age"), { username: "tara.shah", following: "accepted" }), "@tara.shah is not taking messages from you right now.");
});

test("the other refusals keep their own words", () => {
  assert.equal(messageErrorText(refused("pending"), { username: "ben.okafor", following: "accepted" }), "Your message request is waiting for an answer.");
  assert.equal(messageErrorText(refused("blocked"), { username: "ben.okafor" }), "You cannot message this account.");
  assert.equal(messageErrorText(new SocialError("social_suspended", "x", "dm")), "FITX has paused your messages for now.");
  assert.equal(messageErrorText({ code: "PT429", message: "social_rate_limited", hint: "hour" }), "That is a lot in one hour. Try again later.");
});

test("the sheet shows the note or the refusal, and is told the follow state wherever it is opened for a known person", () => {
  const sheet = source("src/components/social/messages/NewMessageSheet.tsx");
  assert.doesNotMatch(sheet, /this goes to their requests/);
  assert.match(sheet, /\{error \? <p className="text-sm text-fitx-danger" role="alert">\{error\}<\/p> : <p className=\{styles\.time\}>\{firstMessageNote\(to\.username\)\}<\/p>\}/);
  assert.match(sheet, /messageErrorText\(failure, \{ username: to\.username, following: initial && to\.id === initial\.id \? following : null \}\)/);
  assert.match(source("src/components/social/messages/MessageButton.tsx"), /setFollowing\(page\?\.relation\.following \?\? null\);/);
  assert.match(source("src/components/social/messages/MessagesView.tsx"), /setInitialFollowing\(page\.relation\.following\);/);
  assert.match(source("src/components/social/messages/SendTo.tsx"), /messageErrorText\(failure, \{ username \}\)/);
});
