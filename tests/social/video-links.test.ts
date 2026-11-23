// /api/social/video-links (wave-2 brief 3.9): POST { paths } → signed .mp4 links for what the member may play, 429
// social_link_budget when today's plays are spent, 503 social_unavailable while explore_video is off. The answer is
// tested over injected calls; the route itself for its refusals that need no database (other sites, no setup). The
// client: own videos are signed with the member's key, others only through the route, and kept for most of a link's life.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import "../billing/support/server-only.mjs";
import { answerVideoLinks, parsePaths, type VideoLinkDeps } from "@/app/api/social/video-links/handler";
import { forgetVideoLinks, linkError, VIDEO_LINK_SECONDS, videoLink } from "@/lib/social/video/links";

const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const P = "cccccccc-0000-4000-8000-0000000000c3";
const video = (user = A, post = P, n = 0) => `${user}/${post}/${n}.mp4`;

const deps = (over: Partial<VideoLinkDeps> = {}): VideoLinkDeps & { signed: string[][] } => {
  const signed: string[][] = [];
  return {
    signed,
    allowed: async (paths) => paths,
    sign: async (paths, seconds) => {
      assert.equal(seconds, VIDEO_LINK_SECONDS);
      signed.push(paths);
      return Object.fromEntries(paths.map((item) => [item, `https://db.test/sign/${item}?token=t`]));
    },
    ...over,
  };
};

const dbError = (message: string, code = "P0001", hint?: string) => Object.assign(new Error(message), { code, message, hint });

test("paths must be 1 to 10 member video files (<uid>/<uuid>/<n>.mp4); repeats are merged", () => {
  assert.deepEqual(parsePaths([video(), video()]), [video()]);
  assert.equal(parsePaths([]), null);
  assert.equal(parsePaths(Array.from({ length: 11 }, (_, n) => video(A, P, n % 10))), null);
  for (const bad of [`${A}/${P}/0p.webp`, `${A}/${P}/0.webp`, `${A}/profile/a.mp4`, `../${A}/${P}/0.mp4`, `${A}/${P}/10.mp4`, 7]) {
    assert.equal(parsePaths([bad]), null, String(bad));
  }
  assert.equal(parsePaths("x"), null);
});

test("allowed paths are signed for 30 minutes; others are simply left out", async () => {
  const d = deps({ allowed: async () => [video(B)] });
  const answer = await answerVideoLinks({ paths: [video(), video(B)] }, d);
  assert.equal(answer.status, 200);
  assert.deepEqual(Object.keys(answer.body.links as object), [video(B)]);
  assert.equal(answer.body.seconds, 30 * 60);
  assert.deepEqual(d.signed, [[video(B)]]);
});

test("nothing allowed: no signing at all", async () => {
  const d = deps({ allowed: async () => [] });
  const answer = await answerVideoLinks({ paths: [video()] }, d);
  assert.deepEqual(answer, { status: 200, body: { links: {}, seconds: VIDEO_LINK_SECONDS } });
  assert.equal(d.signed.length, 0);
});

test("the database never widens the request: a path it returns that was not asked for is not signed", async () => {
  const d = deps({ allowed: async () => [video(), video(B)] });
  const answer = await answerVideoLinks({ paths: [video()] }, d);
  assert.deepEqual(Object.keys(answer.body.links as object), [video()]);
});

test("explore_video off: 503 social_unavailable, and nothing is signed", async () => {
  const d = deps({ allowed: async () => { throw dbError("social_unavailable"); } });
  assert.deepEqual(await answerVideoLinks({ paths: [video()] }, d), { status: 503, body: { error: "social_unavailable" } });
  assert.equal(d.signed.length, 0);
  // Before the migration is applied the function is missing: also 503, never a 500.
  const missing = deps({ allowed: async () => { throw dbError("Could not find the function", "PGRST202"); } });
  assert.equal((await answerVideoLinks({ paths: [video()] }, missing)).status, 503);
});

test("the platform switch off (explore_video or explore): the route answers 503 itself, before any database call", async () => {
  let asked = 0;
  const off = deps({ allowed: async () => { asked += 1; return [video()]; } });
  const answer = await answerVideoLinks({ paths: [video()] }, { ...off, switchedOn: async () => false });
  assert.deepEqual(answer, { status: 503, body: { error: "social_unavailable" } });
  assert.equal(asked, 0, "the database is not asked while the switch is off");
  assert.equal(off.signed.length, 0);
  // Even an invalid body gets the switch's answer first: nothing about the request matters while videos are off.
  assert.equal((await answerVideoLinks({ paths: "nope" }, { ...deps({}), switchedOn: async () => false })).status, 503);
  // Switched on, the database still decides.
  const on = deps({ allowed: async (paths: string[]) => paths });
  assert.equal((await answerVideoLinks({ paths: [video()] }, { ...on, switchedOn: async () => true })).status, 200);
  // The route reads the same platform settings the proxy reads (both switches).
  const routeSource = readFileSync(path.resolve(process.cwd(), "src/app/api/social/video-links/route.ts"), "utf8");
  assert.match(routeSource, /import \{ readPlatformSettings \} from "@\/lib\/platform\/gate";/);
  assert.match(routeSource, /return features\.explore && features\.explore_video;/);
});

test("today's plays spent: 429 social_link_budget with the database's hint (member or project)", async () => {
  for (const hint of ["member", "project"]) {
    const answer = await answerVideoLinks({ paths: [video()] }, deps({ allowed: async () => { throw dbError("social_link_budget", "PT429", hint); } }));
    assert.deepEqual(answer, { status: 429, body: { error: "social_link_budget", hint } });
  }
});

test("other refusals: invalid body 400, suspended 403, signed out 401, anything else 500", async () => {
  assert.equal((await answerVideoLinks({}, deps())).status, 400);
  assert.equal((await answerVideoLinks({ paths: [video()] }, deps({ allowed: async () => { throw dbError("social_suspended"); } }))).status, 403);
  assert.equal((await answerVideoLinks({ paths: [video()] }, deps({ allowed: async () => { throw dbError("social_signed_out", "42501"); } }))).status, 401);
  assert.deepEqual(await answerVideoLinks({ paths: [video()] }, deps({ allowed: async () => { throw new Error("socket hang up"); } })), { status: 500, body: { error: "failed" } });
  assert.equal((await answerVideoLinks({ paths: [video()] }, deps({ sign: async () => { throw new Error("storage"); } }))).status, 500);
});

describe("the route", () => {
  type Route = { POST: (request: InstanceType<typeof import("next/server").NextRequest>) => Promise<Response> };
  let route: Route;
  let NextRequest: typeof import("next/server").NextRequest;
  before(async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    ({ NextRequest } = await import("next/server"));
    route = (await import("@/app/api/social/video-links/route")) as unknown as Route;
  });
  const request = (headers: Record<string, string>) => new NextRequest("http://fitx.test/api/social/video-links", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ paths: [video()] }),
  });

  test("another site's request is 403", async () => {
    const response = await route.POST(request({ "sec-fetch-site": "cross-site" }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  test("without Supabase and the server key it answers 503 social_unavailable", async () => {
    const response = await route.POST(request({ "sec-fetch-site": "same-origin" }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "social_unavailable" });
  });
});

describe("the client", () => {
  test("the member's own video is signed with their own key, without the route", async () => {
    forgetVideoLinks();
    let fetched = 0;
    const db = { storage: { from: () => ({ createSignedUrl: async (item: string, seconds: number) => ({ data: { signedUrl: `own:${item}:${seconds}` }, error: null }) }) } };
    const url = await videoLink(video(), { ownerId: A, viewerId: A, db: db as never, fetcher: async () => { fetched += 1; return new Response("{}"); } });
    assert.equal(url, `own:${video()}:${VIDEO_LINK_SECONDS}`);
    assert.equal(fetched, 0);
  });

  test("another member's video goes through the route once, then the kept link is reused", async () => {
    forgetVideoLinks();
    const calls: unknown[] = [];
    const fetcher = async (input: string, init: RequestInit) => {
      calls.push([input, JSON.parse(String(init.body))]);
      return Response.json({ links: { [video(B)]: "https://db.test/signed" }, seconds: VIDEO_LINK_SECONDS });
    };
    const first = await videoLink(video(B), { ownerId: B, viewerId: A, db: null, fetcher, now: 1000 });
    const again = await videoLink(video(B), { ownerId: B, viewerId: A, db: null, fetcher, now: 1000 + 20 * 60_000 });
    assert.equal(first, "https://db.test/signed");
    assert.equal(again, first);
    assert.deepEqual(calls, [["/api/social/video-links", { paths: [video(B)] }]]);
    await videoLink(video(B), { ownerId: B, viewerId: A, db: null, fetcher, now: 1000 + 26 * 60_000 });
    assert.equal(calls.length, 2, "renewed before the link expires");
  });

  test("the route's refusals become the member's message", async () => {
    forgetVideoLinks();
    const budget = await linkError(Response.json({ error: "social_link_budget", hint: "member" }, { status: 429 }));
    assert.equal(budget.key, "social_link_budget");
    assert.equal(budget.message, "Videos have reached today’s viewing limit. They play again tomorrow.");
    const paused = await linkError(new Response("", { status: 503 }));
    assert.equal(paused.key, "social_unavailable");
    await assert.rejects(
      videoLink(video(B), { ownerId: B, viewerId: A, db: null, fetcher: async () => Response.json({ error: "social_unavailable" }, { status: 503 }) }),
      (error: { key?: string }) => error.key === "social_unavailable",
    );
    assert.equal(await videoLink("not/a/video.mp4", { ownerId: B, viewerId: A, db: null }), null);
  });
});
