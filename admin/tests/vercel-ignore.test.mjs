// End-to-end checks of the Vercel ignore command against real Git repositories that are
// shaped like this one (FITX at the root, Admin in admin/) and cloned shallowly, as Vercel
// does. Exit code 1 means "build" and exit code 0 means "skip".
//
// The root `npm test` runs this file too, without admin/node_modules: import only Node
// built-ins here (deploy-filter.test.mjs checks this), and rely on nothing but git.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BUILD = 1;
const SKIP = 0;
const CLI = fileURLToPath(new URL("../scripts/vercel-ignore.mjs", import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), "fitx-deploy-filter-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

// Keep the developer's own Git settings (signing, hooks, default branch) and any Vercel or
// FITX deployment variables in their shell out of the tests.
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(?:VERCEL_|GIT_|FITX_)/.test(key)),
);
const gitEnv = {
  ...inherited,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CEILING_DIRECTORIES: workspace,
  GIT_AUTHOR_NAME: "FITX test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "FITX test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
};
// A server that only serves advertised refs, like older Git hosting, refuses commits by SHA.
const refusesShaFetches = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "protocol.version", GIT_CONFIG_VALUE_0: "0" };

let directoryCount = 0;
function freshDirectory(name) {
  const directory = join(workspace, `${name}-${++directoryCount}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commit(repo, files, message = "change") {
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(repo, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
  git(repo, "add", "--all");
  git(repo, "commit", "--quiet", "--allow-empty", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

function createRepository() {
  const repo = freshDirectory("work");
  git(repo, "init", "--quiet", "--initial-branch=master");
  const initial = commit(repo, {
    "package.json": "{}\n",
    "src/app/page.tsx": "export {};\n",
    "admin/package.json": "{}\n",
    "admin/src/app/page.tsx": "export {};\n",
  }, "initial");
  return { repo, initial };
}

/** Mirrors Vercel: the repository is published to an origin and the branch is cloned shallowly. */
function shallowClone(repo, branch, depth = 10) {
  const origin = freshDirectory("origin");
  git(workspace, "clone", "--quiet", "--bare", repo, origin);
  const clone = freshDirectory("clone");
  git(workspace, "clone", "--quiet", `--depth=${depth}`, "--branch", branch, pathToFileURL(origin).href, clone);
  return clone;
}

function hasCommit(repo, sha) {
  return spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repo, env: gitEnv }).status === 0;
}

function runFilter(cwd, target, env = {}) {
  const args = target === undefined ? [CLI] : [CLI, target];
  const result = spawnSync(process.execPath, args, { cwd, env: { ...gitEnv, ...env }, encoding: "utf8", timeout: 60_000 });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function deployment(previous, current, branch = "master") {
  return { VERCEL_GIT_PREVIOUS_SHA: previous ?? "", VERCEL_GIT_COMMIT_SHA: current, VERCEL_GIT_COMMIT_REF: branch };
}

function decide(clone, env) {
  return { fitx: runFilter(clone, "fitx", env).status, admin: runFilter(join(clone, "admin"), "admin", env).status };
}

test("missing deployment details or an unknown target build instead of skipping", () => {
  const { repo, initial } = createRepository();
  assert.equal(runFilter(repo, "fitx").status, BUILD);
  assert.equal(runFilter(repo, "admin", { VERCEL_GIT_COMMIT_SHA: "not-a-sha" }).status, BUILD);
  assert.equal(runFilter(repo, "admin", { VERCEL_GIT_COMMIT_SHA: initial, VERCEL_GIT_PREVIOUS_SHA: "--output=x" }).status, BUILD);
  assert.equal(runFilter(repo, "unknown", { VERCEL_GIT_COMMIT_SHA: initial }).status, BUILD);
  assert.equal(runFilter(repo, undefined, { VERCEL_GIT_COMMIT_SHA: initial }).status, BUILD);
});

test("a redeploy or promotion of the same commit builds both apps", () => {
  const { repo, initial } = createRepository();
  const result = runFilter(join(repo, "admin"), "admin", deployment(initial, initial));
  assert.equal(result.status, BUILD);
  assert.match(result.output, /redeploy/);
  assert.equal(runFilter(repo, "fitx", deployment(initial, initial)).status, BUILD);
});

test("an empty diff builds both apps", () => {
  const { repo, initial } = createRepository();
  const empty = commit(repo, {}, "empty commit");
  assert.deepEqual(decide(repo, deployment(initial, empty)), { fitx: BUILD, admin: BUILD });
});

test("each project builds only for changes that affect it", () => {
  const { repo, initial } = createRepository();
  const adminOnly = commit(repo, { "admin/src/app/page.tsx": "export const admin = 1;\n" });
  const fitxOnly = commit(repo, { "src/app/page.tsx": "export const fitx = 1;\n" });
  const shared = commit(repo, { "package.json": "{ \"private\": true }\n" });
  const docsOnly = commit(repo, { "docs/notes.md": "# Notes\n" });
  const clone = shallowClone(repo, "master");

  assert.deepEqual(decide(clone, deployment(initial, adminOnly)), { fitx: SKIP, admin: BUILD });
  assert.deepEqual(decide(clone, deployment(adminOnly, fitxOnly)), { fitx: BUILD, admin: SKIP });
  assert.deepEqual(decide(clone, deployment(fitxOnly, shared)), { fitx: BUILD, admin: BUILD });
  assert.deepEqual(decide(clone, deployment(shared, docsOnly)), { fitx: BUILD, admin: SKIP });
});

test("FITX_FORCE_BUILD makes every deployment build", () => {
  const { repo, initial } = createRepository();
  const fitxOnly = commit(repo, { "src/app/page.tsx": "export const fitx = 4;\n" });
  const env = deployment(initial, fitxOnly);
  assert.equal(runFilter(join(repo, "admin"), "admin", env).status, SKIP);

  for (const value of ["1", "true", " TRUE "]) {
    const result = runFilter(join(repo, "admin"), "admin", { ...env, FITX_FORCE_BUILD: value });
    assert.equal(result.status, BUILD, `FITX_FORCE_BUILD=${value}`);
    assert.match(result.output, /FITX_FORCE_BUILD is set/);
  }
  for (const value of ["", "0", "false", "no"]) {
    assert.equal(runFilter(join(repo, "admin"), "admin", { ...env, FITX_FORCE_BUILD: value }).status, SKIP, `FITX_FORCE_BUILD=${value}`);
  }
});

test("a production build of a branch other than master builds, because it is a promotion", () => {
  const { repo } = createRepository();
  git(repo, "switch", "--quiet", "-c", "feature/promoted");
  const before = commit(repo, { "src/app/promoted.tsx": "export const step = 1;\n" });
  const after = commit(repo, { "src/app/promoted.tsx": "export const step = 2;\n" });
  const clone = shallowClone(repo, "feature/promoted");
  const env = deployment(before, after, "feature/promoted");

  const promoted = runFilter(join(clone, "admin"), "admin", { ...env, VERCEL_ENV: "production" });
  assert.equal(promoted.status, BUILD);
  assert.match(promoted.output, /promotion/);
  assert.equal(runFilter(join(clone, "admin"), "admin", { ...env, VERCEL_ENV: "preview" }).status, SKIP);
  assert.equal(runFilter(join(clone, "admin"), "admin", { ...env, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "" }).status, BUILD);

  // Production pushes on master itself are still filtered by path.
  const { repo: mainRepo, initial } = createRepository();
  const fitxOnly = commit(mainRepo, { "src/app/page.tsx": "export const fitx = 5;\n" });
  const mainClone = shallowClone(mainRepo, "master");
  assert.equal(runFilter(join(mainClone, "admin"), "admin", { ...deployment(initial, fitxOnly), VERCEL_ENV: "production" }).status, SKIP);
});

test("skipped pushes accumulate until a relevant change arrives", () => {
  const { repo, initial } = createRepository();
  commit(repo, { "src/app/one.tsx": "export {};\n" });
  const twoFitxPushes = commit(repo, { "src/app/two.tsx": "export {};\n" });
  const thenAdmin = commit(repo, { "admin/src/app/page.tsx": "export const later = 1;\n" });
  const clone = shallowClone(repo, "master");
  // VERCEL_GIT_PREVIOUS_SHA stays at the last successful build while builds are skipped.
  assert.equal(runFilter(join(clone, "admin"), "admin", deployment(initial, twoFitxPushes)).status, SKIP);
  assert.equal(runFilter(join(clone, "admin"), "admin", deployment(initial, thenAdmin)).status, BUILD);
});

test("a previous commit older than the shallow clone is fetched before comparing", () => {
  const { repo } = createRepository();
  const previous = commit(repo, { "admin/src/app/page.tsx": "export const v = 1;\n" }, "last Admin build");
  let current = previous;
  for (let index = 0; index < 12; index++) current = commit(repo, { [`src/app/page-${index}.tsx`]: "export {};\n" }, `FITX ${index}`);

  const clone = shallowClone(repo, "master", 3);
  assert.equal(hasCommit(clone, previous), false);
  // Only FITX files changed since the last Admin build, so Admin skipping proves the commit was fetched.
  assert.deepEqual(decide(clone, deployment(previous, current)), { fitx: BUILD, admin: SKIP });

  const strictClone = shallowClone(repo, "master", 3);
  const result = runFilter(join(strictClone, "admin"), "admin", { ...deployment(previous, current), ...refusesShaFetches });
  assert.equal(result.status, SKIP, "falls back to fetching the branch with more history");
});

test("in a full clone, missing commits are fetched without making the clone shallow", () => {
  const { repo } = createRepository();
  const masterHead = commit(repo, { "src/app/page.tsx": "export const fitx = 3;\n" });
  git(repo, "switch", "--quiet", "-c", "elsewhere");
  const elsewhere = commit(repo, { "src/app/elsewhere.tsx": "export {};\n" });
  git(repo, "switch", "--quiet", "-c", "feature/full-clone", "master");
  const featureHead = commit(repo, { "src/app/feature.tsx": "export {};\n" });
  git(repo, "switch", "--quiet", "master");

  const origin = freshDirectory("origin");
  git(workspace, "clone", "--quiet", "--bare", repo, origin);
  const masterClone = freshDirectory("full-clone");
  git(workspace, "clone", "--quiet", "--single-branch", "--branch", "master", pathToFileURL(origin).href, masterClone);
  assert.equal(hasCommit(masterClone, elsewhere), false);
  // The only difference from the fetched commit is a FITX file, so Admin skipping proves the fetch.
  assert.equal(runFilter(join(masterClone, "admin"), "admin", deployment(elsewhere, masterHead)).status, SKIP);
  assert.equal(git(masterClone, "rev-parse", "--is-shallow-repository"), "false");

  const featureClone = freshDirectory("full-clone");
  git(workspace, "clone", "--quiet", "--single-branch", "--branch", "feature/full-clone", pathToFileURL(origin).href, featureClone);
  assert.equal(runFilter(join(featureClone, "admin"), "admin", deployment(null, featureHead, "feature/full-clone")).status, SKIP);
  assert.equal(git(featureClone, "rev-parse", "--is-shallow-repository"), "false");
});

test("a previous commit that cannot be fetched, or a folder outside Git, builds", () => {
  const { repo } = createRepository();
  const current = commit(repo, { "src/app/page.tsx": "export const fitx = 2;\n" });
  const clone = shallowClone(repo, "master");
  assert.equal(runFilter(join(clone, "admin"), "admin", deployment("f".repeat(40), current)).status, BUILD);

  git(clone, "remote", "remove", "origin");
  assert.equal(runFilter(join(clone, "admin"), "admin", deployment("e".repeat(40), current)).status, BUILD);

  const outside = freshDirectory("not-a-repository");
  assert.equal(runFilter(outside, "admin", deployment("a".repeat(40), "b".repeat(40))).status, BUILD);
});

test("a branch's first deployment compares with the point where it left master", () => {
  const { repo } = createRepository();
  commit(repo, { "src/lib/base.ts": "export {};\n" }, "master before the fork");

  git(repo, "switch", "--quiet", "-c", "feature/fitx-only");
  let fitxBranch = "";
  for (let index = 0; index < 12; index++) fitxBranch = commit(repo, { [`src/app/feature-${index}.tsx`]: "export {};\n" });

  // Master moves on with an Admin change after the fork. Comparing with master's tip would
  // wrongly treat that change as part of the branch.
  git(repo, "switch", "--quiet", "master");
  commit(repo, { "admin/src/app/page.tsx": "export const onMaster = true;\n" }, "Admin change on master");

  git(repo, "switch", "--quiet", "-c", "feature/admin-only");
  const adminBranch = commit(repo, { "admin/src/lib/new.ts": "export {};\n" });

  const fitxClone = shallowClone(repo, "feature/fitx-only");
  assert.deepEqual(decide(fitxClone, deployment(null, fitxBranch, "feature/fitx-only")), { fitx: BUILD, admin: SKIP });

  const adminClone = shallowClone(repo, "feature/admin-only");
  assert.deepEqual(decide(adminClone, deployment(null, adminBranch, "feature/admin-only")), { fitx: SKIP, admin: BUILD });

  const strictClone = shallowClone(repo, "feature/fitx-only");
  const strict = runFilter(join(strictClone, "admin"), "admin", { ...deployment(null, fitxBranch, "feature/fitx-only"), ...refusesShaFetches });
  assert.equal(strict.status, SKIP, "deepens the branch by name when commits cannot be fetched by SHA");
});

test("a first deployment on master, or one without a reachable origin, builds", () => {
  const { repo } = createRepository();
  const current = commit(repo, { "src/app/page.tsx": "export const first = 1;\n" });
  const clone = shallowClone(repo, "master");
  assert.deepEqual(decide(clone, deployment(null, current, "master")), { fitx: BUILD, admin: BUILD });

  git(repo, "switch", "--quiet", "-c", "feature/no-origin");
  const branchHead = commit(repo, { "src/app/other.tsx": "export {};\n" });
  const orphanClone = shallowClone(repo, "feature/no-origin");
  git(orphanClone, "remote", "remove", "origin");
  assert.deepEqual(decide(orphanClone, deployment(null, branchHead, "feature/no-origin")), { fitx: BUILD, admin: BUILD });
  assert.deepEqual(decide(orphanClone, deployment(null, branchHead, "")), { fitx: BUILD, admin: BUILD });
});
