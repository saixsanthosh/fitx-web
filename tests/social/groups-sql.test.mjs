// Explore part 2 groups (20261124100010) on a throwaway local Postgres: direct messages (requests, dm_policy, blocks
// mid-conversation, unsend, the duplicate-text spam stop, shared posts checked again for the reader and after they are
// deleted, story replies also after the clean-up, the age gate and unread counts, which leave out suspended members),
// communities (directory, private requests, member-only posts, moderator removal limited
// to their own community) and challenges (values from the member's own rows from when they joined, no double count of
// an activity and a workout, opted-out members never on the board, still listed for its members between end and close,
// closing only after the final sync, badges and template rollover). Ends with the header's undo and a second run. Skipped when the Postgres binaries are missing.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LocalPostgres, MIGRATIONS_DIR, available } from "../support/local-postgres.mjs";

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";
const FILE = path.join(MIGRATIONS_DIR, "20261124100010_fitx_social_v2_groups.sql");
const uid = (n) => `9a000000-2222-4000-8000-${String(n).padStart(12, "0")}`;
const A = uid(1); // Asha, adult
const B = uid(2); // Ben, adult
const C = uid(3); // Chen, adult
const D = uid(4); // Dev, adult
const T = uid(5); // a teen
const U = uid(6); // no date of birth
const as = (sub) => ({ role: "authenticated", sub });
const q = (text) => (text === null ? "null" : `'${String(text).replace(/'/g, "''")}'`);
let seq = 0;
const id = () => `0000eeee-2222-4000-8000-${String(++seq).padStart(12, "0")}`;

describe("Explore part 2 groups", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  const call = (who, sql) => pg.json(`select to_jsonb(${sql});`, as(who));
  const fails = (who, sql, pattern) => {
    const r = pg.run(`select ${sql};`, as(who));
    assert.ok(!r.ok && pattern.test(r.stderr), `${sql}: ${r.stderr || "no error"}`);
    return r.stderr;
  };
  const send = (who, to, body, extra = "") => call(who, `public.fitx_social_send_message('${to}', ${q(body)}${extra})`);
  const photoPost = (who, caption = "Post") => {
    const post = id();
    pg.exec(`insert into storage.objects (bucket_id, name, metadata) values ('social-media', '${who}/${post}/0.webp', '{"size": 2048}');`, as(who));
    return call(who, `public.fitx_social_create_post('${post}', ${q(caption)}, null, '[]', 'everyone', '[{"path": "${who}/${post}/0.webp", "width": 10, "height": 10}]')`);
  };
  const resetLimits = () => pg.exec(`delete from public.social_rate_counters;`);

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations();
    const people = [[A, "asha.grp"], [B, "ben.grp"], [C, "chen.grp"], [D, "dev.grp"], [T, "teen.grp"], [U, "una.grp"]];
    pg.exec(`insert into auth.users (id, email) values ${people.map(([who], n) => `('${who}', 'g${n}@example.test')`).join(", ")};
      update public.profiles set date_of_birth = date '1990-01-01' where id in ('${A}', '${B}', '${C}', '${D}');
      update public.profiles set date_of_birth = (current_date - interval '15 years')::date where id = '${T}';
      update public.profiles set date_of_birth = null, age = null where id = '${U}';`);
    for (const [who, name] of people) pg.exec(`select public.fitx_social_save_profile('${name}', 'X', '', false, 'everyone');`, as(who));
  });
  after(() => pg?.stop());

  test("messages need an adult on both sides; the refusal names the sender's own band", () => {
    assert.match(fails(T, `public.fitx_social_send_message('${A}', 'Hi there')`, /social_age_restricted/), /teen/);
    assert.match(fails(U, `public.fitx_social_conversations(null, 'inbox')`, /social_age_restricted/), /unknown/);
    assert.match(fails(A, `public.fitx_social_send_message('${T}', 'Hi there')`, /social_dm_not_allowed/), /age/);
    const counts = call(T, "public.fitx_social_unread_counts()");
    assert.equal(counts.messages, null, "unknown is never 0");
    assert.equal(counts.requests, null);
    assert.equal(typeof counts.notifications, "number");
  });

  test("dm_policy: followers by default, everyone, mutuals and off", () => {
    // Ben does not follow Asha and Asha does not follow Ben: the default (followers) refuses Asha.
    assert.match(fails(A, `public.fitx_social_send_message('${B}', 'Hello Ben')`, /social_dm_not_allowed/), /policy/);
    assert.equal(call(B, "public.fitx_social_set_dm_policy('everyone')"), "everyone");
    fails(B, "public.fitx_social_set_dm_policy('nobody')", /social_invalid/);
    const first = send(A, B, "Hello Ben");
    assert.equal(first.status, "request", "a stranger's first message is a request");
    // One message until Ben answers.
    assert.match(fails(A, `public.fitx_social_send_message('${B}', 'Are you there?')`, /social_dm_not_allowed/), /pending/);
    // Ben gets one notice that names nobody, and the request is in his Requests, not his inbox.
    const notes = pg.json(`select coalesce(json_agg(json_build_object('type', type, 'actor', actor_id)), '[]') from public.social_notifications where user_id = '${B}' and type like 'message%';`);
    assert.deepEqual(notes, [{ type: "message_request", actor: null }]);
    assert.equal(call(B, "public.fitx_social_conversations(null, 'inbox')").length, 0);
    const requests = call(B, "public.fitx_social_conversations(null, 'requests')");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].last.body, "Hello Ben");
    assert.equal(call(B, "public.fitx_social_unread_counts()").requests, 1);
    // Asha sees her own waiting request in her inbox.
    assert.equal(call(A, "public.fitx_social_conversations(null, 'inbox')")[0].requested_by_me, true);
    // Ben accepts: it moves to his inbox and both may write.
    assert.equal(call(B, `public.fitx_social_answer_conversation('${first.conversation_id}', true)`).status, "accepted");
    assert.equal(send(A, B, "Thanks for accepting").status, "accepted");
    assert.equal(call(B, "public.fitx_social_unread_counts()").messages, 1);
    call(B, `public.fitx_social_mark_conversation_read('${first.conversation_id}')`);
    assert.equal(call(B, "public.fitx_social_unread_counts()").messages, 0);

    // Mutuals: only accounts that follow each other; off: nobody new.
    call(C, "public.fitx_social_set_dm_policy('mutuals')");
    call(D, `public.fitx_social_follow('${C}')`);
    fails(D, `public.fitx_social_send_message('${C}', 'Hi Chen')`, /social_dm_not_allowed/);
    call(C, `public.fitx_social_follow('${D}')`);
    assert.equal(send(D, C, "Hi Chen").status, "accepted", "mutuals who follow each other land in the inbox");
    call(C, "public.fitx_social_set_dm_policy('off')");
    fails(A, `public.fitx_social_send_message('${C}', 'Hi')`, /social_dm_not_allowed/);
    assert.equal(send(C, D, "Still here").status, "accepted", "an accepted conversation carries on");
    call(C, "public.fitx_social_set_dm_policy('followers')");
  });

  test("a follower the recipient follows back lands in the inbox, unless restricted; replying accepts a request", () => {
    pg.exec(`delete from public.social_conversations; delete from public.social_notifications;`);
    resetLimits();
    call(B, "public.fitx_social_set_dm_policy('followers')");
    call(A, `public.fitx_social_follow('${B}')`);
    call(B, `public.fitx_social_follow('${A}')`);
    call(B, `public.fitx_social_set_restrict('${A}', true)`);
    const restricted = send(A, B, "Hi from Asha");
    assert.equal(restricted.status, "request", "a restricted member lands in Requests");
    const reply = send(B, A, "Hi back");
    assert.equal(reply.status, "accepted", "replying to a request accepts it");
    assert.equal(pg.json(`select to_json(status) from public.social_conversations where id = '${restricted.conversation_id}';`), "accepted");
    call(B, `public.fitx_social_set_restrict('${A}', false)`);
  });

  test("blocking mid-conversation stops messages and hides the conversation either way", () => {
    const conversation = pg.json(`select to_json(id) from public.social_conversations where user_low = least('${A}'::uuid, '${B}'::uuid) and user_high = greatest('${A}'::uuid, '${B}'::uuid);`);
    call(B, `public.fitx_social_set_block('${A}', true)`);
    assert.match(fails(A, `public.fitx_social_send_message('${B}', 'Still there?')`, /social_dm_not_allowed/), /blocked/);
    fails(B, `public.fitx_social_send_message('${A}', 'Bye')`, /social_dm_not_allowed/);
    fails(A, `public.fitx_social_messages('${conversation}', null, null)`, /social_not_found/);
    assert.equal(call(A, "public.fitx_social_conversations(null, 'inbox')").length, 0);
    assert.equal(call(B, "public.fitx_social_conversations(null, 'inbox')").length, 0);
    call(B, `public.fitx_social_set_block('${A}', false)`);
    assert.equal(call(A, `public.fitx_social_messages('${conversation}', null, null)`).messages.length, 2, "history comes back after the unblock");
  });

  test("unsending blanks the body; only the sender can unsend; it works while suspended", () => {
    const sent = send(A, B, "Something I regret");
    fails(B, `public.fitx_social_unsend_message('${sent.message.id}')`, /social_not_found/);
    pg.exec(`insert into public.social_member_sanctions (user_id, kind, reason_code) values ('${A}', 'explore', 'spam');`);
    assert.equal(call(A, `public.fitx_social_unsend_message('${sent.message.id}')`), true);
    pg.exec(`update public.social_member_sanctions set lifted_at = now() where user_id = '${A}';`);
    const row = pg.json(`select json_build_object('body', body, 'deleted', deleted_at is not null) from public.social_messages where id = '${sent.message.id}';`);
    assert.deepEqual(row, { body: "", deleted: true });
    const shown = call(B, `public.fitx_social_messages('${sent.conversation_id}', null, null)`).messages.find((m) => m.id === sent.message.id);
    assert.equal(shown.unsent, true);
    assert.equal(shown.body, "");
  });

  test("the same longer text into three other conversations within an hour is refused", () => {
    resetLimits();
    for (const who of [B, C, D]) call(who, "public.fitx_social_set_dm_policy('everyone')");
    const spam = "Buy my training plan today";
    pg.exec(`delete from public.social_conversations where '${D}' in (user_low, user_high);`);
    pg.exec(`insert into auth.users (id, email) values ('${uid(20)}', 's0@example.test'), ('${uid(21)}', 's1@example.test'), ('${uid(22)}', 's2@example.test');
      update public.profiles set date_of_birth = date '1990-01-01' where id in ('${uid(20)}', '${uid(21)}', '${uid(22)}');`);
    for (const [n, who] of [uid(20), uid(21), uid(22)].entries()) {
      pg.exec(`select public.fitx_social_save_profile('spam${n}.grp', 'S', '', false, 'everyone'); select public.fitx_social_set_dm_policy('everyone');`, as(who));
    }
    // A fresh Explore account may start 2 requests a day; the spammer is older than 7 days.
    pg.exec(`update public.social_profiles set created_at = now() - interval '30 days' where user_id = '${D}';`);
    send(D, uid(20), spam);
    send(D, uid(21), spam);
    send(D, uid(22), spam);
    fails(D, `public.fitx_social_send_message('${B}', ${q(spam)})`, /social_rate_limited/);
    assert.equal(send(D, B, "A different hello").status, "request", "other text still goes");
  });

  test("a new Explore account may start only two requests a day", () => {
    resetLimits();
    pg.exec(`insert into auth.users (id, email) values ('${uid(30)}', 'new@example.test'); update public.profiles set date_of_birth = date '1991-01-01' where id = '${uid(30)}';`);
    pg.exec(`select public.fitx_social_save_profile('fresh.grp', 'F', '', false, 'everyone');`, as(uid(30)));
    pg.exec(`delete from public.social_conversations where '${uid(30)}' in (user_low, user_high);`);
    send(uid(30), uid(20), "One");
    send(uid(30), uid(21), "Two");
    fails(uid(30), `public.fitx_social_send_message('${uid(22)}', 'Three')`, /social_rate_limited/);
  });

  test("a shared post is checked again for the reader every time", () => {
    resetLimits();
    pg.exec(`delete from public.social_conversations; delete from public.social_follows;`);
    call(B, "public.fitx_social_set_dm_policy('everyone')");
    const post = photoPost(C, "Chen's squat");
    const sent = send(A, B, "", `, '${post.id}'`);
    assert.equal(sent.message.post.id, post.id);
    call(B, `public.fitx_social_answer_conversation('${sent.conversation_id}', true)`);
    const read = () => call(B, `public.fitx_social_messages('${sent.conversation_id}', null, null)`).messages[0];
    assert.equal(read().post.id, post.id, "Ben sees Chen's public post");
    call(C, `public.fitx_social_set_block('${B}', true)`);
    assert.equal(read().post, null, "after Chen blocks Ben, Ben no longer sees the post");
    assert.equal(read().post_unavailable, true);
    call(C, `public.fitx_social_set_block('${B}', false)`);
    pg.exec(`update public.social_profiles set is_private = true where user_id = '${C}';`);
    assert.equal(read().post, null, "a private account's post needs a follow");
    pg.exec(`update public.social_profiles set is_private = false where user_id = '${C}';`);
    const hidden = photoPost(D, "Dev's post");
    pg.exec(`update public.social_posts set moderation_state = 'hidden' where id = '${hidden.id}';`);
    fails(A, `public.fitx_social_send_message('${B}', '', '${hidden.id}')`, /social_not_found/);
  });

  test("a story reply needs the owner's live story and tells them with story_reply", () => {
    resetLimits();
    const story = id();
    pg.exec(`insert into public.social_stories (id, user_id, kind, storage_path, width, height) values ('${story}', '${B}', 'image', '${B}/${story}/0.webp', 10, 10);`);
    fails(A, `public.fitx_social_send_message('${C}', 'Nice', null, '${story}')`, /social_not_found/);
    fails(A, `public.fitx_social_send_message('${B}', '', null, '${story}')`, /social_invalid/);
    const reply = send(A, B, "Great set!", `, null, '${story}'`);
    assert.equal(reply.message.story.id, story);
    const note = pg.json(`select json_build_object('type', type, 'actor', actor_id, 'story', story_id) from public.social_notifications where user_id = '${B}' and type = 'story_reply';`);
    assert.deepEqual(note, { type: "story_reply", actor: A, story });
    pg.exec(`update public.social_stories set created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' where id = '${story}';`);
    fails(A, `public.fitx_social_send_message('${B}', 'Again', null, '${story}')`, /social_story_expired/);
    const shown = call(B, `public.fitx_social_messages('${reply.conversation_id}', null, null)`).messages.find((m) => m.id === reply.message.id);
    assert.equal(shown.story.available, false, "an ended story shows as gone");
  });

  test("a shared post deleted later reads as no longer available, and a story reply keeps its tag after the clean-up", () => {
    resetLimits();
    const post = photoPost(A, "Asha's bench");
    const withText = send(A, B, "Look at this", `, '${post.id}'`);
    const shared = send(A, B, "", `, '${post.id}'`);
    assert.equal(call(A, `public.fitx_social_delete_post('${post.id}')`).length, 1);
    const read = (who, message) => call(who, `public.fitx_social_messages('${shared.conversation_id}', null, null)`).messages.find((m) => m.id === message);
    for (const who of [A, B]) {
      const gone = read(who, shared.message.id);
      assert.equal(gone.post, null);
      assert.equal(gone.post_unavailable, true, "a deleted post is no longer available, not an empty bubble");
      assert.equal(gone.story, null);
      assert.equal(read(who, withText.message.id).post_unavailable, true, "its text stays, with the note");
      assert.equal(read(who, withText.message.id).body, "Look at this");
    }
    const inbox = call(B, "public.fitx_social_conversations(null, 'inbox')").find((c) => c.id === shared.conversation_id);
    assert.equal(inbox.last.kind, "post", "the inbox still says a post was shared");
    // An unsent shared post is unsent, not unavailable.
    call(A, `public.fitx_social_unsend_message('${shared.message.id}')`);
    const unsent = read(B, shared.message.id);
    assert.deepEqual([unsent.unsent, unsent.post_unavailable, unsent.story], [true, false, null]);

    const story = id();
    pg.exec(`insert into public.social_stories (id, user_id, kind, storage_path, width, height) values ('${story}', '${B}', 'image', '${B}/${story}/0.webp', 10, 10);`);
    const reply = send(A, B, "Strong finish", `, null, '${story}'`);
    pg.exec(`update public.social_stories set created_at = now() - interval '26 hours', expires_at = now() - interval '2 hours' where id = '${story}';`);
    pg.exec(`select public.fitx_social_hourly();`);
    assert.equal(pg.json(`select count(*) from public.social_stories where id = '${story}';`), 0, "the clean-up deleted the story");
    for (const who of [A, B]) {
      const tagged = read(who, reply.message.id);
      assert.deepEqual(tagged.story, { id: null, available: false }, "still a reply to a story, which has ended");
      assert.equal(tagged.body, "Strong finish");
      assert.equal(tagged.post_unavailable, false);
    }
    assert.equal(call(B, "public.fitx_social_conversations(null, 'inbox')").find((c) => c.id === reply.conversation_id).last.kind, "story");
    // A plain message is neither.
    const plain = send(A, B, "See you Monday");
    assert.deepEqual([read(B, plain.message.id).story, read(B, plain.message.id).post_unavailable], [null, false]);
  });

  test("a suspended member's messages and requests leave the unread counts until the suspension is lifted", () => {
    resetLimits();
    pg.exec(`delete from public.social_conversations; delete from public.social_notifications; delete from public.social_follows;`);
    call(B, "public.fitx_social_set_dm_policy('everyone')");
    call(B, `public.fitx_social_follow('${A}')`);
    assert.equal(send(A, B, "Accepted hello").status, "accepted");
    assert.equal(send(C, B, "A request hello").status, "request");
    const counts = () => call(B, "public.fitx_social_unread_counts()");
    const before = counts();
    assert.deepEqual([before.messages, before.requests], [1, 1]);
    pg.exec(`insert into public.social_member_sanctions (user_id, kind, reason_code) values ('${A}', 'explore', 'spam'), ('${C}', 'explore', 'spam');`);
    const lift = () => pg.exec(`update public.social_member_sanctions set lifted_at = now() where user_id in ('${A}', '${C}') and lifted_at is null;`);
    try {
      const during = counts();
      assert.deepEqual([during.messages, during.requests], [0, 0], "nothing the member cannot open is counted");
      assert.equal(call(B, "public.fitx_social_conversations(null, 'inbox')").length, 0);
      assert.equal(call(B, "public.fitx_social_conversations(null, 'requests')").length, 0);
      assert.equal(during.notifications, before.notifications - 2, "nor their message notices");
      // A suspension that has run out counts again.
      pg.exec(`update public.social_member_sanctions set created_at = now() - interval '8 days', until = now() - interval '1 minute' where user_id = '${A}' and lifted_at is null;`);
      assert.deepEqual([counts().messages, counts().requests], [1, 0]);
    } finally {
      lift();
    }
    assert.deepEqual([counts().messages, counts().requests, counts().notifications], [1, 1, before.notifications]);
    call(B, `public.fitx_social_unfollow('${A}')`);
  });

  test("other members' messages are never readable through the table", () => {
    assert.equal(pg.json(`select count(*) from public.social_messages where user_id <> '${B}';`, as(B)), 0);
  });

  describe("communities", () => {
    const OPEN = uid(100);
    const CLOSED = uid(101);
    const OTHER = uid(102);
    before(() => {
      pg.exec(`insert into public.social_communities (id, slug, name, description, visibility) values
        ('${OPEN}', 'morning-runners', 'Morning runners', 'Early miles', 'public'),
        ('${CLOSED}', 'strength-club', 'Strength club', 'Heavy lifting', 'private'),
        ('${OTHER}', 'yoga-flow', 'Yoga flow', 'Stretch', 'public');
        insert into public.social_community_members (community_id, user_id, role, status) values
        ('${CLOSED}', '${C}', 'moderator', 'accepted'), ('${OPEN}', '${C}', 'moderator', 'accepted'), ('${OTHER}', '${D}', 'moderator', 'accepted');`);
      resetLimits();
    });

    test("adults only; the directory lists public and private communities, with search", () => {
      fails(T, "public.fitx_social_communities(null)", /social_age_restricted/);
      fails(U, "public.fitx_social_join_community('" + OPEN + "')", /social_age_restricted/);
      const all = call(A, "public.fitx_social_communities(null)");
      assert.deepEqual(all.map((c) => c.slug).sort(), ["morning-runners", "strength-club", "yoga-flow"]);
      assert.deepEqual(call(A, "public.fitx_social_communities('heavy')").map((c) => c.slug), ["strength-club"]);
      pg.exec(`update public.social_communities set moderation_state = 'limited' where id = '${OTHER}';`);
      assert.equal(call(A, "public.fitx_social_communities('yoga')").length, 0, "a limited community leaves the directory");
      assert.equal(call(D, "public.fitx_social_communities('yoga')").length, 1, "its members still see it");
      pg.exec(`update public.social_communities set moderation_state = 'visible' where id = '${OTHER}';`);
    });

    test("a public community takes members at once; a private one waits for its moderators", () => {
      assert.equal(call(A, `public.fitx_social_join_community('${OPEN}')`).status, "accepted");
      assert.equal(call(A, `public.fitx_social_join_community('${CLOSED}')`).status, "pending");
      fails(A, `public.fitx_social_community_posts('${CLOSED}', null, null)`, /social_not_member/);
      const note = pg.json(`select json_build_object('type', type, 'actor', actor_id, 'community', community_id) from public.social_notifications where user_id = '${C}' and type = 'community_request';`);
      assert.deepEqual(note, { type: "community_request", actor: A, community: CLOSED });
      const page = call(C, "public.fitx_social_community('strength-club')");
      assert.equal(page.is_moderator, true);
      assert.deepEqual(page.requests.map((r) => r.user.id), [A]);
      assert.deepEqual(call(A, "public.fitx_social_community('strength-club')").requests, [], "only moderators see requests");
      fails(B, `public.fitx_social_answer_community_request('${CLOSED}', '${A}', true)`, /social_not_found/);
      assert.equal(call(C, `public.fitx_social_answer_community_request('${CLOSED}', '${A}', true)`).status, "accepted");
      assert.equal(pg.json(`select count(*) from public.social_notifications where user_id = '${A}' and type = 'community_accepted' and actor_id is null;`), 1);
      assert.equal(call(A, "public.fitx_social_community('strength-club')").can_post, true);
    });

    test("community posts and discussions are for accepted members; private ones stay inside", () => {
      const discussion = call(A, `public.fitx_social_create_group_post('${id()}', 'Who is lifting tonight?', '[]', null, '${CLOSED}', null)`);
      assert.equal(discussion.kind, "text");
      fails(B, `public.fitx_social_create_group_post('${id()}', 'Me too', '[]', null, '${CLOSED}', null)`, /social_not_member/);
      fails(A, `public.fitx_social_create_group_post('${id()}', 'x', '[]', null, '${CLOSED}', '${uid(999)}')`, /social_invalid/);
      assert.equal(call(C, `public.fitx_social_community_posts('${CLOSED}', null, null)`).length, 1);
      assert.equal(call(B, `public.fitx_social_post('${discussion.id}')`), null, "a non-member never reads a private community's post");
      fails(B, `public.fitx_social_community_posts('${CLOSED}', null, null)`, /social_not_member/);
    });

    test("moderators hide posts in their own community only, and the author is told without naming them", () => {
      const post = call(A, `public.fitx_social_create_group_post('${id()}', 'Off-topic sale', '[]', null, '${OPEN}', null)`);
      call(D, `public.fitx_social_join_community('${OPEN}')`);
      fails(D, `public.fitx_social_moderator_remove_post('${post.id}', 'spam')`, /social_not_found/);
      const plain = photoPost(A, "Not in a community");
      fails(C, `public.fitx_social_moderator_remove_post('${plain.id}', 'spam')`, /social_not_found/);
      assert.equal(call(C, `public.fitx_social_moderator_remove_post('${post.id}', 'spam')`), true);
      assert.equal(pg.json(`select to_json(moderation_state) from public.social_posts where id = '${post.id}';`), "hidden");
      const action = pg.json(`select json_build_object('actor_kind', actor_kind, 'operator', operator_id, 'community', community_id, 'user', target_user_id, 'reason', reason_code) from public.social_moderation_actions where target_id = '${post.id}';`);
      assert.deepEqual(action, { actor_kind: "member", operator: null, community: OPEN, user: A, reason: "spam" });
      const note = pg.json(`select json_build_object('type', type, 'actor', actor_id, 'community', community_id) from public.social_notifications where user_id = '${A}' and type = 'report_reviewed';`);
      assert.deepEqual(note, { type: "report_reviewed", actor: null, community: OPEN });
      assert.equal(call(D, `public.fitx_social_post('${post.id}')`), null, "others no longer see it");
      assert.equal(call(A, `public.fitx_social_post('${post.id}')`).moderation, "hidden", "its author still does");
    });

    test("leaving is open while suspended", () => {
      pg.exec(`insert into public.social_member_sanctions (user_id, kind, reason_code) values ('${A}', 'explore', 'spam');`);
      fails(A, `public.fitx_social_join_community('${OTHER}')`, /social_suspended/);
      assert.equal(call(A, `public.fitx_social_leave_community('${OPEN}')`), true);
      pg.exec(`update public.social_member_sanctions set lifted_at = now() where user_id = '${A}';`);
      assert.equal(call(A, "public.fitx_social_community('morning-runners')").community.my_status, "none");
    });
  });

  describe("challenges", () => {
    const WEEK = uid(200);
    const activity = (who, startedAt, minutes, km, sport = "run") => pg.exec(`insert into public.activities (user_id, client_id, sport, title, started_at, ended_at, elapsed_seconds, moving_seconds, distance_m)
      values ('${who}', gen_random_uuid(), '${sport}', 'Run', ${startedAt}, ${startedAt} + interval '${minutes} minutes', ${minutes * 60}, ${minutes * 60}, ${km * 1000});`);
    const workout = (who, completedAt, minutes, status = "completed") => pg.exec(`insert into public.workout_sessions (user_id, name, status, started_at, completed_at, duration_seconds)
      values ('${who}', 'Session', '${status}', ${completedAt} - interval '${minutes} minutes', ${completedAt}, ${minutes * 60});`);
    const make = (cid, metric, { target = "null", sport = "null", starts = "now() - interval '2 days'", ends = "now() + interval '5 days'" } = {}) =>
      pg.exec(`insert into public.social_challenges (id, kind, title, metric, sport, target, starts_at, ends_at) values ('${cid}', 'weekly', 'Challenge ${metric}', '${metric}', ${sport === "null" ? "null" : q(sport)}, ${target}, ${starts}, ${ends});`);
    const entry = (cid, who) => pg.json(`select json_build_object('value', value::float8) from public.social_challenge_entries where challenge_id = '${cid}' and user_id = '${who}';`);

    before(() => {
      pg.exec(`delete from public.social_challenges; delete from public.activities; delete from public.workout_sessions;`);
      resetLimits();
    });

    test("values come only from the member's own rows, from when they joined", () => {
      make(WEEK, "workouts");
      // Before Asha joins: not counted. Another member's rows: never counted. An abandoned session: not counted.
      workout(A, "now() - interval '1 day'", 40);
      workout(B, "now() - interval '1 hour'", 40);
      call(A, `public.fitx_social_join_challenge('${WEEK}')`);
      pg.exec(`update public.social_challenge_entries set joined_at = now() - interval '12 hours' where challenge_id = '${WEEK}' and user_id = '${A}';`);
      workout(A, "now() - interval '2 hours'", 30);
      workout(A, "now() - interval '1 hour'", 30, "abandoned");
      pg.exec(`select public.fitx_social_challenge_sync('${WEEK}', '${A}');`);
      assert.deepEqual(entry(WEEK, A), { value: 1 });
      fails(A, `public.fitx_social_challenge_sync('${WEEK}', '${A}')`, /permission denied/);
      fails(A, "public.fitx_social_challenge_tick(null)", /permission denied/);
    });

    test("distance follows the sport; active minutes count an activity and a workout at the same time once; days are counted in Kolkata", () => {
      const DIST = id();
      const MINUTES = id();
      const DAYS = id();
      make(DIST, "distance_km", { sport: "run" });
      make(MINUTES, "active_minutes");
      make(DAYS, "active_days");
      for (const cid of [DIST, MINUTES, DAYS]) {
        pg.exec(`insert into public.social_challenge_entries (challenge_id, user_id, joined_at) values ('${cid}', '${C}', now() - interval '2 days');`);
      }
      // A 30-minute run 10:00 to 10:30 Kolkata time yesterday, also logged as a workout over the same half hour, plus a ride.
      const yesterday = "((current_date - 1)::timestamp + interval '10 hours') at time zone 'Asia/Kolkata'";
      activity(C, yesterday, 30, 5.25);
      workout(C, `${yesterday} + interval '30 minutes'`, 30);
      activity(C, `${yesterday} + interval '5 hours'`, 20, 8, "ride");
      for (const cid of [DIST, MINUTES, DAYS]) pg.exec(`select public.fitx_social_challenge_sync('${cid}', '${C}');`);
      assert.deepEqual(entry(DIST, C), { value: 5.25 }, "only the run counts towards a run challenge");
      assert.deepEqual(entry(MINUTES, C), { value: 50 }, "30 + 20 minutes; the workout over the run adds nothing");
      assert.deepEqual(entry(DAYS, C), { value: 1 });
    });

    test("the board holds adults who opted in; teens may join but not show on it", () => {
      call(B, `public.fitx_social_join_challenge('${WEEK}')`);
      call(T, `public.fitx_social_join_challenge('${WEEK}')`);
      fails(T, `public.fitx_social_set_leaderboard('${WEEK}', true)`, /social_age_restricted/);
      fails(T, `public.fitx_social_challenge_board('${WEEK}')`, /social_age_restricted/);
      assert.equal(call(T, `public.fitx_social_challenge('${WEEK}')`).board_allowed, false);
      pg.exec(`update public.social_challenge_entries set joined_at = now() - interval '12 hours' where challenge_id = '${WEEK}' and user_id = '${B}';`);
      workout(B, "now() - interval '30 minutes'", 20);
      pg.exec(`select public.fitx_social_challenge_sync('${WEEK}', '${B}');`);
      // Ben has counted a workout but has not opted in: nobody sees him on the board.
      assert.equal(call(A, `public.fitx_social_challenge_board('${WEEK}')`).size, 0);
      call(A, `public.fitx_social_set_leaderboard('${WEEK}', true)`);
      const board = call(B, `public.fitx_social_challenge_board('${WEEK}')`);
      assert.deepEqual(board.rows.map((r) => [r.user.id, r.rank, r.value]), [[A, 1, 1]]);
      assert.equal(board.me, null, "Ben is not on it");
      // A teen's row never reaches the board, even if it were switched on behind the app's back.
      pg.exec(`update public.social_challenge_entries set on_leaderboard = true where user_id = '${T}'; update public.social_challenge_entries set value = 9 where user_id = '${T}';`);
      assert.equal(call(B, `public.fitx_social_challenge_board('${WEEK}')`).size, 1);
    });

    test("a progress share carries the computed value; a typed one is impossible", () => {
      const share = call(A, `public.fitx_social_create_group_post('${id()}', 'Week going well', '[]', null, null, '${WEEK}')`);
      assert.equal(share.entry.value, 1);
      assert.equal(share.challenge_id, WEEK);
      fails(D, `public.fitx_social_create_group_post('${id()}', 'Me too', '[]', null, null, '${WEEK}')`, /social_not_member/);
      const page = call(B, `public.fitx_social_challenge('${WEEK}')`);
      assert.equal(page.posts[0].entry.value, 1);
      assert.equal(page.posts[0].entry.rank, 1);
    });

    test("a challenge closes only after its grace period and a final sync, then awards badges", () => {
      const ENDED = id();
      make(ENDED, "workouts", { target: 2, starts: "now() - interval '8 days'", ends: "now() - interval '1 hour'" });
      pg.exec(`insert into public.social_challenge_entries (challenge_id, user_id, joined_at, value) values ('${ENDED}', '${D}', now() - interval '8 days', 0);`);
      workout(D, "now() - interval '3 days'", 30);
      workout(D, "now() - interval '2 days'", 30);
      // Still inside the 2-hour grace: synced, not closed.
      pg.exec(`select public.fitx_social_challenge_tick();`);
      const open = pg.json(`select json_build_object('closed', closed_at is not null) from public.social_challenges where id = '${ENDED}';`);
      assert.deepEqual(open, { closed: false });
      assert.deepEqual(entry(ENDED, D), { value: 2 }, "the hourly tick synced the late import");
      // Past the grace: a final sync first (another late import), then closed with the badge.
      workout(D, "now() - interval '200 minutes'", 30);
      pg.exec(`update public.social_challenges set ends_at = now() - interval '3 hours', starts_at = now() - interval '9 days' where id = '${ENDED}';`);
      const result = pg.json(`select public.fitx_social_challenge_tick();`);
      assert.equal(result.closed, 1);
      assert.deepEqual(entry(ENDED, D), { value: 3 });
      assert.equal(pg.json(`select to_json(array_agg(kind)) from public.social_challenge_badges where challenge_id = '${ENDED}' and user_id = '${D}';`)[0], "completed");
      assert.equal(pg.json(`select count(*) from public.social_notifications where user_id = '${D}' and type = 'challenge_badge' and challenge_id = '${ENDED}';`), 1);
      assert.equal(call(D, "public.fitx_social_challenges('closed')")[0].badges[0], "completed");
      fails(D, `public.fitx_social_join_challenge('${ENDED}')`, /social_challenge_closed/);
      fails(D, `public.fitx_social_leave_challenge('${ENDED}')`, /social_challenge_closed/);
      // No top-3 badge with fewer than 10 members on the board.
      assert.equal(pg.json(`select count(*) from public.social_challenge_badges where kind = 'top3';`), 0);
    });

    test("between its end and its close a challenge stays under Open for those who joined, then moves to Finished", () => {
      const GRACE = id();
      make(GRACE, "workouts", { starts: "now() - interval '7 days'", ends: "now() - interval '1 hour'" });
      pg.exec(`insert into public.social_challenge_entries (challenge_id, user_id, joined_at) values ('${GRACE}', '${B}', now() - interval '6 days');`);
      const listed = (who, box) => call(who, `public.fitx_social_challenges('${box}')`).some((c) => c.id === GRACE);
      assert.equal(listed(B, "open"), true, "a member who joined still sees it, with 'Final count soon'");
      assert.equal(listed(B, "closed"), false);
      assert.equal(listed(A, "open"), false, "nobody else is offered an ended challenge");
      pg.exec(`select public.fitx_social_challenge_tick();`);
      assert.equal(listed(B, "open"), true, "still inside the 2-hour grace");
      pg.exec(`update public.social_challenges set ends_at = now() - interval '3 hours' where id = '${GRACE}';`);
      pg.exec(`select public.fitx_social_challenge_tick();`);
      assert.equal(listed(B, "open"), false);
      assert.equal(listed(B, "closed"), true, "closed: under Finished");
    });

    test("Top 3 needs 10 members on the board; Admin's close closes one challenge now", () => {
      const BIG = id();
      make(BIG, "workouts");
      const members = Array.from({ length: 10 }, (_, n) => uid(300 + n));
      pg.exec(`insert into auth.users (id, email) values ${members.map((who, n) => `('${who}', 'b${n}@example.test')`).join(", ")};
        update public.profiles set date_of_birth = date '1990-01-01' where id in (${members.map(q).join(", ")});
        insert into public.social_profiles (user_id, username, display_name) values ${members.map((who, n) => `('${who}', 'board${n}.grp', 'B')`).join(", ")};
        insert into public.social_challenge_entries (challenge_id, user_id, joined_at, on_leaderboard) select '${BIG}', u, now() - interval '1 day', true from unnest(array[${members.map(q).join(", ")}]::uuid[]) u;`);
      members.forEach((who, n) => { for (let k = 0; k <= n; k += 1) workout(who, `now() - interval '${k + 1} hours'`, 10); });
      const result = pg.json(`select public.fitx_social_challenge_tick('${BIG}');`);
      assert.equal(result.closed, 1, "only the one challenge");
      assert.equal(pg.json(`select count(*) from public.social_challenges where closed_at is not null and id <> '${BIG}' and ends_at > now();`), 0);
      const top = pg.json(`select coalesce(json_agg(user_id order by user_id), '[]') from public.social_challenge_badges where challenge_id = '${BIG}' and kind = 'top3';`);
      assert.deepEqual(top, members.slice(7).sort());
    });

    test("templates open this week's and this month's challenge once, in Kolkata time", () => {
      pg.exec(`insert into public.social_challenge_templates (id, kind, title, metric, target) values ('${uid(400)}', 'weekly', 'Three workouts', 'workouts', 3), ('${uid(401)}', 'monthly', 'Ten active days', 'active_days', 10);
        insert into public.social_challenge_templates (kind, title, metric, active) values ('weekly', 'Retired', 'workouts', false);`);
      const first = pg.json(`select public.fitx_social_challenge_tick();`);
      assert.equal(first.opened, 2);
      assert.equal(pg.json(`select public.fitx_social_challenge_tick();`).opened, 0, "never twice for the same window");
      const weekly = pg.json(`select json_build_object('start', to_char(starts_at at time zone 'Asia/Kolkata', 'ID HH24:MI'), 'days', extract(day from ends_at - starts_at)::int) from public.social_challenges where template_id = '${uid(400)}';`);
      assert.deepEqual(weekly, { start: "1 00:00", days: 7 }, "Monday 00:00 to the next Monday");
      const monthly = pg.json(`select to_json(to_char(starts_at at time zone 'Asia/Kolkata', 'DD HH24:MI')) from public.social_challenges where template_id = '${uid(401)}';`);
      assert.equal(monthly, "01 00:00");
      const open = call(U, "public.fitx_social_challenges('open')").map((c) => c.title);
      assert.ok(open.includes("Three workouts") && open.includes("Ten active days"), open.join(", "));
    });

    test("a community's challenge needs its membership", () => {
      const club = uid(500);
      const cid = id();
      pg.exec(`insert into public.social_communities (id, slug, name, visibility) values ('${club}', 'lifters-only', 'Lifters only', 'private');
        insert into public.social_community_members (community_id, user_id, role, status) values ('${club}', '${C}', 'owner', 'accepted');
        insert into public.social_challenges (id, kind, title, metric, starts_at, ends_at, community_id) values ('${cid}', 'weekly', 'Club week', 'workouts', now(), now() + interval '7 days', '${club}');`);
      assert.equal(call(B, `public.fitx_social_challenge('${cid}')`), null);
      fails(B, `public.fitx_social_join_challenge('${cid}')`, /social_not_found/);
      assert.equal(call(C, `public.fitx_social_join_challenge('${cid}')`).joined, true);
    });
  });

  test("the header's undo removes everything this file adds, and the file applies again unchanged", () => {
    const sql = readFileSync(FILE, "utf8");
    const lines = sql.split("\n");
    const from = lines.findIndex((line) => line.startsWith("-- Undo"));
    const undo = lines.slice(from + 1).filter((line) => line.startsWith("--   ")).map((line) => line.slice(5)).join("\n");
    assert.match(undo, /^begin;/);
    const count = () => pg.json(`select json_build_object('functions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname ~ '^fitx_social_(send_message|conversations|messages|answer_conversation|mark_conversation_read|unsend_message|set_dm_policy|unread_counts|communities|community|community_posts|join_community|answer_community_request|leave_community|create_group_post|moderator_remove_post|challenges|challenge|join_challenge|leave_challenge|set_leaderboard|challenge_board|challenge_sync|challenge_tick)$'),
      'index', (select count(*) from pg_indexes where indexname = 'workout_sessions_user_completed_idx'));`);
    assert.deepEqual(count(), { functions: 24, index: 1 });
    pg.exec(undo);
    assert.deepEqual(count(), { functions: 0, index: 0 });
    pg.applyFile(FILE, { singleTransaction: true });
    pg.applyFile(FILE, { singleTransaction: true });
    assert.deepEqual(count(), { functions: 24, index: 1 });
  });
});
