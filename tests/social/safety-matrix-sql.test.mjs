// The Explore safety matrix (wave 2, 20261124100000): generated cells of
//   viewer (self, stranger, pending, accepted follower, blocked either way, restricted, community member, teen, unknown age)
//   × owner (active, suspended, deleted)
//   × content state (visible, limited, hidden; for stories also expired, and expired with an open report)
//   × content (post, community post, video, comment, story).
// Each cell asserts the RPC read, the RLS select, the bucket read (can_read_object, and that another member's .mp4 is
// never signed), the discovery listing (hashtag browse; the story tray per owner), whether a notification about the
// item is shown, and whether the viewer's own interaction with it creates a notification for the owner. The expected
// values come from one small model (`sees` below) of the rules the migration states, so a rule change shows up as a
// diff here. Fixtures are written as the superuser; every check runs as the viewer with RLS, one psql call per viewer.
// Skipped when the Postgres binaries are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { LocalPostgres, available } from "../support/local-postgres.mjs";

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";
const q = (text) => (text === null ? "null" : `'${String(text).replace(/'/g, "''")}'`);
let seq = 0;
const uuid = (prefix) => `${prefix}-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export const VIEWERS = ["self", "stranger", "pending", "accepted", "blocker", "blocked", "restricted", "member", "teen", "unknown"];
export const OWNERS = ["active", "suspended", "deleted"];
export const CONTENT = {
  post: ["visible", "limited", "hidden"],
  community: ["visible", "limited", "hidden"],
  video: ["visible", "limited", "hidden"],
  comment: ["visible", "limited", "hidden"],
  story: ["visible", "limited", "hidden", "expired", "expired_reported"],
};
const POSTS = new Set(["post", "community", "video"]);

/** The rules, as the migration states them: whether `viewer` may see an item of `kind` in `state` by an `owner`. */
export function sees(viewer, owner, kind, state) {
  if (owner === "deleted") return false;
  const live = !state.startsWith("expired");
  if (viewer === "self") return kind === "story" ? live : true;
  if (owner === "suspended") return false;
  if (viewer === "blocker" || viewer === "blocked") return false;
  if (state !== "visible" && state !== "limited") return false;
  const follower = viewer === "accepted";
  if (kind === "community") {
    if (viewer === "teen" || viewer === "unknown") return false;
    return state === "visible" || follower || viewer === "member";
  }
  if (kind === "comment") return state === "visible";
  return state === "visible" || follower;
}

/** Every expectation for one viewer, keyed as the SQL below keys its answers. */
export function expected(viewer, items) {
  const out = {};
  for (const item of items) {
    const { key, owner, kind, state } = item;
    if (viewer === "self" && owner === "deleted") continue;
    const visible = sees(viewer, owner, kind, state);
    const ownSuspended = viewer === "self" && owner === "suspended";
    out[`${key}:rpc`] = visible && !ownSuspended;
    out[`${key}:rls`] = visible;
    if (kind !== "comment") out[`${key}:obj`] = viewer === "self" ? true : visible;
    if (kind === "video") out[`${key}:mp4`] = viewer === "self";
    if (POSTS.has(kind)) out[`${key}:listed`] = visible && !ownSuspended && (viewer === "self" || state === "visible");
    if (viewer !== "self") {
      out[`${key}:note`] = visible;
      out[`${key}:notify`] = visible && viewer !== "restricted";
    }
  }
  for (const owner of OWNERS) {
    if (viewer === "self" && owner === "deleted") continue;
    const stories = items.filter((i) => i.owner === owner && i.kind === "story");
    const inTray = viewer === "self" ? owner === "active" : viewer === "accepted";
    out[`${owner}:tray`] = inTray ? stories.filter((s) => sees(viewer, owner, "story", s.state)).length : 0;
  }
  return out;
}

describe("Explore safety matrix", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  const OWNER_ID = { active: uuid("0a0a0a0a"), suspended: uuid("0b0b0b0b"), deleted: uuid("0c0c0c0c") };
  const VIEWER_ID = Object.fromEntries(VIEWERS.filter((v) => v !== "self").map((v) => [v, uuid("0d0d0d0d")]));
  const COMMUNITY = uuid("0e0e0e0e");
  const items = [];
  const hostPost = {};

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations();
    const sql = [];
    const users = [...Object.values(OWNER_ID), ...Object.values(VIEWER_ID)];
    sql.push(`insert into auth.users (id, email) values ${users.map((id, n) => `('${id}', 'm${n}@example.test')`).join(", ")};`);
    sql.push(`update public.profiles set date_of_birth = date '1990-01-01' where id in (${users.map(q).join(", ")});`);
    sql.push(`update public.profiles set date_of_birth = (current_date - interval '15 years')::date where id = '${VIEWER_ID.teen}';`);
    sql.push(`update public.profiles set date_of_birth = null, age = null where id = '${VIEWER_ID.unknown}';`);
    sql.push(`insert into public.social_profiles (user_id, username, display_name) values ${users.map((id, n) => `('${id}', 'matrix${n}', 'Matrix ${n}')`).join(", ")};`);
    sql.push(`update public.platform_settings set features = features || '{"explore_video": true}'::jsonb where id = 1;`);
    sql.push(`insert into public.social_communities (id, slug, name, visibility) values ('${COMMUNITY}', 'matrix-club', 'Matrix club', 'public');`);
    const members = [...Object.values(OWNER_ID), VIEWER_ID.member];
    sql.push(`insert into public.social_community_members (community_id, user_id, role, status) values ${members.map((id) => `('${COMMUNITY}', '${id}', 'member', 'accepted')`).join(", ")};`);

    OWNERS.forEach((owner, ownerIndex) => {
      const O = OWNER_ID[owner];
      const tag = `mx${ownerIndex}`;
      sql.push(`insert into public.social_follows (user_id, following_id, status) values ('${VIEWER_ID.pending}', '${O}', 'pending'), ('${VIEWER_ID.accepted}', '${O}', 'accepted');`);
      sql.push(`insert into public.social_blocks (user_id, blocked_id) values ('${VIEWER_ID.blocker}', '${O}'), ('${O}', '${VIEWER_ID.blocked}');`);
      sql.push(`insert into public.social_restricts (user_id, restricted_id) values ('${O}', '${VIEWER_ID.restricted}');`);
      const object = (name) => sql.push(`insert into storage.objects (bucket_id, name, owner_id, metadata) values ('social-media', ${q(name)}, '${O}', '{"size": 2048}');`);
      const insertPost = (id, kind, caption, community = null) =>
        sql.push(`insert into public.social_posts (id, user_id, kind, caption, community_id) values ('${id}', '${O}', '${kind}', ${q(caption)}, ${community ? q(community) : "null"}); select public.fitx_social_tag_post('${id}', ${q(caption)});`);
      const host = uuid("0f0f0f0f");
      hostPost[owner] = host;
      insertPost(host, "photo", "Host post");
      for (const [kind, states] of Object.entries(CONTENT)) {
        for (const state of states) {
          const key = `${owner}.${kind}.${state}`;
          const item = { key, owner, kind, state, ownerId: O };
          if (POSTS.has(kind)) {
            const id = uuid("1a1a1a1a");
            item.id = id;
            insertPost(id, kind === "video" ? "video" : "photo", `Matrix #${tag}`, kind === "community" ? COMMUNITY : null);
            if (kind === "video") {
              item.path = `${O}/${id}/0p.webp`;
              item.mp4 = `${O}/${id}/0.mp4`;
              object(item.mp4);
              object(item.path);
              sql.push(`insert into public.social_post_media (post_id, user_id, position, kind, storage_path, poster_path, width, height, duration_ms, bytes) values ('${id}', '${O}', 0, 'video', ${q(item.mp4)}, ${q(item.path)}, 720, 1280, 12000, 4096);`);
            } else {
              item.path = `${O}/${id}/0.webp`;
              object(item.path);
              sql.push(`insert into public.social_post_media (post_id, user_id, position, kind, storage_path, width, height, bytes) values ('${id}', '${O}', 0, 'image', ${q(item.path)}, 1200, 1500, 2048);`);
            }
            sql.push(`update public.social_posts set moderation_state = '${state}' where id = '${id}';`);
          } else if (kind === "comment") {
            const id = uuid("2b2b2b2b");
            item.id = id;
            sql.push(`insert into public.social_comments (id, post_id, user_id, body, moderation_state) values ('${id}', '${host}', '${O}', 'Matrix comment', '${state}');`);
          } else {
            const id = uuid("3c3c3c3c");
            item.id = id;
            item.path = `${O}/${id}/0.webp`;
            object(item.path);
            const moderation = state.startsWith("expired") ? "visible" : state;
            const times = state.startsWith("expired") ? "now() - interval '25 hours', now() - interval '1 hour'" : "now(), now() + interval '24 hours'";
            sql.push(`insert into public.social_stories (id, user_id, kind, storage_path, width, height, bytes, created_at, expires_at, moderation_state) values ('${id}', '${O}', 'image', ${q(item.path)}, 1080, 1920, 2048, ${times}, '${moderation}');`);
            if (state === "expired_reported") {
              sql.push(`insert into public.social_reports (user_id, target_type, target_id, target_user_id, reason) values ('${VIEWER_ID.stranger}', 'story', '${id}', '${O}', 'other');`);
            }
          }
          items.push(item);
          // A notification to every other viewer about this item, as if the owner had mentioned them.
          for (const viewerId of Object.values(VIEWER_ID)) {
            item.notes ??= {};
            const nid = uuid("4d4d4d4d");
            item.notes[viewerId] = nid;
            const target = kind === "comment"
              ? `'mention', 'comment', '${item.id}', '${host}', '${item.id}', null`
              : kind === "story" ? `'story_reply', 'story', '${item.id}', null, null, '${item.id}'`
                : `'mention', 'post', '${item.id}', '${item.id}', null, null`;
            sql.push(`insert into public.social_notifications (id, user_id, actor_id, type, entity_type, entity_id, post_id, comment_id, story_id) values ('${nid}', '${viewerId}', '${O}', ${target});`);
          }
        }
      }
    });
    sql.push(`insert into public.social_member_sanctions (user_id, kind, reason_code) values ('${OWNER_ID.suspended}', 'explore', 'harassment');`);
    pg.exec(sql.join("\n"));
    pg.exec(`delete from auth.users where id = '${OWNER_ID.deleted}';`);
  });
  after(() => pg?.stop());

  /** One query, as `viewerId` with RLS, answering every check for every item. */
  function answers(viewerId) {
    const rows = [];
    const add = (key, expr) => rows.push(`(${q(key)}, to_jsonb((${expr})))`);
    const listed = {};
    OWNERS.forEach((owner, n) => { listed[owner] = `(select coalesce(jsonb_agg(x->>'id'), '[]') from jsonb_array_elements(coalesce(pg_temp.try('select public.fitx_social_browse(null, ''mx${n}'', null, null, null, 30)'), '[]')) x)`; });
    const notes = `(select coalesce(jsonb_agg(x->>'id'), '[]') from jsonb_array_elements(coalesce(pg_temp.try('select public.fitx_social_notifications(null, null, 50)'), '[]')) x)`;
    for (const item of items) {
      const { key, kind, id } = item;
      const ownerId = item.ownerId;
      if (POSTS.has(kind)) {
        add(`${key}:rpc`, `pg_temp.try('select public.fitx_social_post(''${id}'')') is not null and pg_temp.try('select public.fitx_social_post(''${id}'')') <> 'null'::jsonb`);
        add(`${key}:rls`, `exists (select 1 from public.social_posts where id = '${id}')`);
        add(`${key}:listed`, `${listed[item.owner]} ? '${id}'`);
        add(`${key}:notify`, `pg_temp.try('select to_jsonb(public.fitx_social_set_like(''${id}'', true))') is not null`);
      } else if (kind === "comment") {
        add(`${key}:rpc`, `coalesce(pg_temp.try('select public.fitx_social_comments(''${hostPost[item.owner]}'')'), '[]') @> '[{"id": "${id}"}]'`);
        add(`${key}:rls`, `exists (select 1 from public.social_comments where id = '${id}')`);
        add(`${key}:notify`, `pg_temp.try('select public.fitx_social_add_comment(''${hostPost[item.owner]}'', ''${id}'', ''Matrix reply'')') is not null`);
      } else {
        add(`${key}:rpc`, `coalesce(pg_temp.try('select public.fitx_social_stories(''${ownerId}'')'), '[]') @> '[{"id": "${id}"}]'`);
        add(`${key}:rls`, `exists (select 1 from public.social_stories where id = '${id}')`);
        add(`${key}:notify`, `pg_temp.try('select public.fitx_social_set_story_like(''${id}'', true)') is not null`);
      }
      if (item.path) add(`${key}:obj`, `exists (select 1 from storage.objects where bucket_id = 'social-media' and name = ${q(item.path)})`);
      if (item.mp4) add(`${key}:mp4`, `exists (select 1 from storage.objects where bucket_id = 'social-media' and name = ${q(item.mp4)})`);
      if (item.notes?.[viewerId]) add(`${key}:note`, `${notes} ? '${item.notes[viewerId]}'`);
    }
    OWNERS.forEach((owner) => {
      add(`${owner}:tray`, `coalesce((select (x->>'count')::int from jsonb_array_elements(coalesce(pg_temp.try('select public.fitx_social_story_tray()'), '[]')) x where x->'user'->>'id' = '${OWNER_ID[owner]}'), 0)`);
    });
    const sql = `create function pg_temp.try(p_query text) returns jsonb language plpgsql as $t$
      declare r jsonb; begin execute p_query into r; return r; exception when others then return null; end $t$;
      select jsonb_object_agg(k, v) from (values ${rows.join(",\n")}) t(k, v);`;
    return pg.json(sql, { role: "authenticated", sub: viewerId });
  }

  /** Whether the owner received a notification from the viewer's interaction with each item (as the superuser). */
  function notified(viewerId) {
    return pg.json(`select coalesce(jsonb_agg(distinct coalesce(n.post_id::text, '') || '|' || coalesce(n.story_id::text, '') || '|' || coalesce(c.parent_id::text, '')), '[]')
      from public.social_notifications n left join public.social_comments c on c.id = n.comment_id
      where n.actor_id = '${viewerId}' and n.type in ('like', 'story_like', 'comment');`);
  }

  for (const viewer of VIEWERS) {
    test(`viewer: ${viewer}`, () => {
      const cells = [];
      const runs = viewer === "self"
        ? OWNERS.filter((o) => o !== "deleted").map((owner) => ({ viewerId: OWNER_ID[owner], scope: (i) => i.owner === owner, owners: [owner] }))
        : [{ viewerId: VIEWER_ID[viewer], scope: () => true, owners: OWNERS }];
      for (const run of runs) {
        const mine = items.filter(run.scope);
        const got = answers(run.viewerId);
        const want = expected(viewer, mine);
        const sent = viewer === "self" ? [] : notified(run.viewerId);
        for (const [key, value] of Object.entries(want)) {
          if (key.endsWith(":tray")) {
            if (!run.owners.includes(key.split(":")[0])) continue;
          }
          let actual = got[key];
          if (key.endsWith(":notify")) {
            // A refused interaction answers null; a created one must also have told the owner (or not, when
            // restricted), so the cell compares the notification the owner holds.
            const item = items.find((i) => `${i.key}:notify` === key);
            const mark = item.kind === "story" ? `|${item.id}|` : item.kind === "comment" ? `${hostPost[item.owner]}||${item.id}` : `${item.id}||`;
            actual = sent.includes(mark);
          }
          cells.push({ key, want: value, got: actual });
        }
      }
      const wrong = cells.filter((c) => c.got !== c.want).map((c) => `${c.key}: expected ${c.want}, got ${c.got}`);
      assert.deepEqual(wrong, [], `${viewer}: ${cells.length} cells`);
      assert.ok(cells.length > 40, `${viewer}: the matrix produced ${cells.length} cells`);
    });
  }

  test("a suspended member's own reads stop with social_suspended, and their own rows stay theirs", () => {
    const r = pg.run(`select public.fitx_social_feed();`, { role: "authenticated", sub: OWNER_ID.suspended });
    assert.ok(!r.ok && /social_suspended/.test(r.stderr), r.stderr);
    assert.ok(pg.json(`select to_jsonb(public.fitx_social_me());`, { role: "authenticated", sub: OWNER_ID.suspended }).suspension, "me says so");
  });

  test("a message notice follows its conversation: not across a block either way or a suspension, and a request's only while it waits", () => {
    const [X, Y, Z] = [uuid("5e5e5e5e"), uuid("5e5e5e5e"), uuid("5e5e5e5e")];
    const [REQUEST, CHAT] = [uuid("6f6f6f6f"), uuid("6f6f6f6f")];
    const [REQUEST_NOTE, CHAT_NOTE] = [uuid("7a7a7a7a"), uuid("7a7a7a7a")];
    pg.exec(`insert into auth.users (id, email) values ('${X}', 'x@example.test'), ('${Y}', 'y@example.test'), ('${Z}', 'z@example.test');
      update public.profiles set date_of_birth = date '1990-01-01' where id in ('${X}', '${Y}', '${Z}');
      insert into public.social_profiles (user_id, username, display_name) values ('${X}', 'notex', 'X'), ('${Y}', 'notey', 'Y'), ('${Z}', 'notez', 'Z');
      insert into public.social_conversations (id, user_low, user_high, status, requested_by, last_message_at) values
        ('${REQUEST}', least('${X}'::uuid, '${Y}'::uuid), greatest('${X}'::uuid, '${Y}'::uuid), 'request', '${Y}', now()),
        ('${CHAT}', least('${X}'::uuid, '${Z}'::uuid), greatest('${X}'::uuid, '${Z}'::uuid), 'accepted', '${Z}', now());
      insert into public.social_conversation_sides (conversation_id, user_id) values ('${REQUEST}', '${X}'), ('${REQUEST}', '${Y}'), ('${CHAT}', '${X}'), ('${CHAT}', '${Z}');
      insert into public.social_messages (conversation_id, user_id, body) values ('${REQUEST}', '${Y}', 'Hello'), ('${CHAT}', '${Z}', 'Hi again');
      insert into public.social_notifications (id, user_id, actor_id, type, entity_type, entity_id, conversation_id) values
        ('${REQUEST_NOTE}', '${X}', null, 'message_request', 'conversation', '${REQUEST}', '${REQUEST}'),
        ('${CHAT_NOTE}', '${X}', '${Z}', 'message', 'conversation', '${CHAT}', '${CHAT}');`);
    const shown = () => {
      const got = pg.json(`select jsonb_build_object('ids', (select coalesce(jsonb_agg(x->>'id' order by x->>'id'), '[]') from jsonb_array_elements(public.fitx_social_notifications(null, null, 50)) x),
        'unread', (public.fitx_social_me())->'unread');`, { role: "authenticated", sub: X });
      return { request: got.ids.includes(REQUEST_NOTE), chat: got.ids.includes(CHAT_NOTE), unread: got.unread };
    };
    assert.deepEqual(shown(), { request: true, chat: true, unread: 2 });
    const cell = (label, setup, undo, want) => {
      pg.exec(setup);
      assert.deepEqual(shown(), want, label);
      pg.exec(undo);
      assert.deepEqual(shown(), { request: true, chat: true, unread: 2 }, `${label}, undone`);
    };
    cell("the recipient blocks the requester", `insert into public.social_blocks (user_id, blocked_id) values ('${X}', '${Y}');`,
      `delete from public.social_blocks where user_id = '${X}';`, { request: false, chat: true, unread: 1 });
    cell("the requester blocks the recipient", `insert into public.social_blocks (user_id, blocked_id) values ('${Y}', '${X}');`,
      `delete from public.social_blocks where user_id = '${Y}';`, { request: false, chat: true, unread: 1 });
    cell("the other side of a conversation is blocked", `insert into public.social_blocks (user_id, blocked_id) values ('${X}', '${Z}');`,
      `delete from public.social_blocks where user_id = '${X}';`, { request: true, chat: false, unread: 1 });
    cell("FITX suspends the requester from Explore", `insert into public.social_member_sanctions (user_id, kind, reason_code) values ('${Y}', 'explore', 'spam');`,
      `delete from public.social_member_sanctions where user_id = '${Y}';`, { request: false, chat: true, unread: 1 });
    cell("FITX suspends the other side of a conversation", `insert into public.social_member_sanctions (user_id, kind, reason_code) values ('${Z}', 'explore', 'spam');`,
      `delete from public.social_member_sanctions where user_id = '${Z}';`, { request: true, chat: false, unread: 1 });
    cell("a suspension from messages only leaves Explore's notices alone", `insert into public.social_member_sanctions (user_id, kind, reason_code) values ('${Y}', 'dm', 'spam');`,
      `delete from public.social_member_sanctions where user_id = '${Y}';`, { request: true, chat: true, unread: 2 });
    cell("the recipient deleted the request", `update public.social_conversation_sides set hidden_at = now() where conversation_id = '${REQUEST}' and user_id = '${X}';`,
      `update public.social_conversation_sides set hidden_at = null where conversation_id = '${REQUEST}';`, { request: false, chat: true, unread: 1 });
    cell("the request was accepted", `update public.social_conversations set status = 'accepted' where id = '${REQUEST}';`,
      `update public.social_conversations set status = 'request' where id = '${REQUEST}';`, { request: false, chat: true, unread: 1 });
    cell("the requester left Explore", `delete from public.social_profiles where user_id = '${Y}';`,
      `insert into public.social_profiles (user_id, username, display_name) values ('${Y}', 'notey', 'Y');`, { request: false, chat: true, unread: 1 });
    const other = pg.json(`select to_jsonb(public.fitx_social_notifications(null, null, 50));`, { role: "authenticated", sub: Y });
    assert.ok(!other.some((n) => n.id === REQUEST_NOTE), "a notice is only ever its recipient's");
  });

  test("the hourly clean-up deletes expired stories without an open report and queues their files", () => {
    const expired = items.filter((i) => i.kind === "story" && i.state === "expired" && i.owner !== "deleted");
    const reported = items.filter((i) => i.kind === "story" && i.state === "expired_reported" && i.owner !== "deleted");
    const result = pg.json(`select public.fitx_social_hourly();`);
    assert.ok(result.stories_deleted >= expired.length, JSON.stringify(result));
    for (const story of expired) {
      assert.equal(pg.json(`select count(*) from public.social_stories where id = '${story.id}';`), 0);
      assert.equal(pg.json(`select count(*) from public.social_storage_trash where path = ${q(story.path)} and reason = 'story_expired';`), 1);
    }
    for (const story of reported) {
      assert.equal(pg.json(`select count(*) from public.social_stories where id = '${story.id}';`), 1, "kept for the moderator");
    }
  });
});
