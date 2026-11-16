// Vercel "Ignored Build Step" for both projects, set in /vercel.json and admin/vercel.json:
//   node admin/scripts/vercel-ignore.mjs fitx   (FITX project, runs from the repository root)
//   node scripts/vercel-ignore.mjs admin        (Admin project, runs from admin/)
//
// Exit code 1 builds and exit code 0 skips. Anything unexpected builds: the exit code
// starts at 1, and only a clear "no change affects this app" sets it to 0. This file
// always runs when Node starts it, so it never needs a main-module check.

import { execFileSync } from "node:child_process";
import { TARGETS, parseNameStatusZ, relevantFiles, shouldBuild } from "./deploy-filter.mjs";

process.exitCode = 1;

const BASE_BRANCH = "master";
const FETCH_DEPTH = 200;
const LOCAL_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 60_000;
const SHA_PATTERN = /^[0-9a-f]{7,64}$/i;
const BRANCH_PATTERN = /^(?![-/.])(?!.*\.\.)[\w./-]{1,200}$/;

const target = process.argv[2];
const label = `FITX deploy filter (${TARGETS.includes(target) ? target : "unknown target"})`;

function build(reason) {
  process.exitCode = 1;
  console.log(`${label}: building. ${reason}`);
}

function skip(reason) {
  process.exitCode = 0;
  console.log(`${label}: skipping. ${reason}`);
}

function short(sha) {
  return sha.slice(0, 7);
}

function git(args, { cwd, timeout = LOCAL_TIMEOUT_MS } = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

function succeeds(args, options) {
  try {
    git(args, options);
    return true;
  } catch {
    return false;
  }
}

function hasCommit(root, sha) {
  return succeeds(["cat-file", "-e", `${sha}^{commit}`], { cwd: root });
}

/**
 * Fetches from origin. Vercel's clone is shallow, so the depth is limited; a full clone
 * (someone running this locally) is fetched without a depth, so it never becomes shallow.
 */
function fetchFromOrigin(root, shallow, depth, refspec) {
  const depthArgs = shallow ? [`--depth=${depth}`] : [];
  return succeeds(["fetch", "--no-tags", "--quiet", ...depthArgs, "origin", refspec], { cwd: root, timeout: FETCH_TIMEOUT_MS });
}

function isShallowClone(root) {
  try {
    return git(["rev-parse", "--is-shallow-repository"], { cwd: root }).trim() !== "false";
  } catch {
    return true;
  }
}

function branchRefspec(branch) {
  return `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
}

/**
 * Vercel clones only 10 commits deep. When an older commit is missing, fetch exactly that
 * commit (GitHub allows it), or else fetch the branch with a deeper history.
 */
function ensureCommit(root, shallow, sha, branch) {
  if (hasCommit(root, sha)) return true;
  if (fetchFromOrigin(root, shallow, 1, sha) && hasCommit(root, sha)) return true;
  return Boolean(branch) && fetchFromOrigin(root, shallow, FETCH_DEPTH, branchRefspec(branch)) && hasCommit(root, sha);
}

/** A branch's first deployment has no previous SHA: compare with the point where it left master. */
function mergeBaseWithBaseBranch(root, shallow, current, branch) {
  if (!fetchFromOrigin(root, shallow, FETCH_DEPTH, branchRefspec(BASE_BRANCH))) return null;
  // Deepen this branch too, so the fork point is inside the shallow history.
  if (!fetchFromOrigin(root, shallow, FETCH_DEPTH, current)) {
    fetchFromOrigin(root, shallow, FETCH_DEPTH, branchRefspec(branch));
  }
  try {
    const base = git(["merge-base", `refs/remotes/origin/${BASE_BRANCH}`, current], { cwd: root }).trim();
    return SHA_PATTERN.test(base) ? base : null;
  } catch {
    return null;
  }
}

function describeFailure(error) {
  // Never print git's stderr: a remote URL in it could carry credentials.
  if (error && typeof error === "object") {
    if (typeof error.code === "string") return error.code;
    if (typeof error.status === "number") return `git exited with status ${error.status}`;
  }
  return "unexpected error";
}

function main() {
  if (!TARGETS.includes(target)) {
    build(`Unknown target "${String(target ?? "").slice(0, 40)}"; expected one of: ${TARGETS.join(", ")}.`);
    return;
  }

  const current = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim();
  const previous = (process.env.VERCEL_GIT_PREVIOUS_SHA ?? "").trim();
  const rawBranch = (process.env.VERCEL_GIT_COMMIT_REF ?? "").trim();
  const branch = BRANCH_PATTERN.test(rawBranch) ? rawBranch : "";

  if (!SHA_PATTERN.test(current)) {
    build("Vercel did not provide the commit being deployed, so there is nothing to compare.");
    return;
  }
  if (previous && !SHA_PATTERN.test(previous)) {
    build("The previous deployment's commit is not a valid Git SHA.");
    return;
  }
  if (previous && previous.toLowerCase() === current.toLowerCase()) {
    build("This commit is already deployed, so this is a redeploy or a promotion.");
    return;
  }

  const root = git(["rev-parse", "--show-toplevel"]).trim();
  if (!hasCommit(root, current)) {
    build(`Commit ${short(current)} is not in the clone.`);
    return;
  }

  const shallow = isShallowClone(root);
  let base = previous;
  let since;
  if (base) {
    if (!ensureCommit(root, shallow, base, branch)) {
      build(`The previous deployment's commit ${short(base)} could not be fetched.`);
      return;
    }
    since = `the previous deployment (${short(base)})`;
  } else {
    if (!branch || branch === BASE_BRANCH) {
      build(`This is the first deployment on ${branch || "this branch"}, so there is nothing earlier to compare.`);
      return;
    }
    base = mergeBaseWithBaseBranch(root, shallow, current, branch);
    if (!base) {
      build(`This is the first deployment on ${branch}, and the point where it left ${BASE_BRANCH} could not be found.`);
      return;
    }
    since = `the point where ${branch} left ${BASE_BRANCH} (${short(base)})`;
  }

  const files = parseNameStatusZ(git(["diff", "--name-status", "-z", "--no-renames", base, current, "--"], { cwd: root }));
  if (files.length === 0) {
    build(`No files changed since ${since}, which happens on a redeploy or an empty commit.`);
    return;
  }

  const relevant = relevantFiles(target, files);
  if (shouldBuild(target, files)) {
    const examples = relevant.slice(0, 5).join(", ");
    build(`${relevant.length} of ${files.length} changed files since ${since} affect this app, for example ${examples}.`);
  } else {
    skip(`None of the ${files.length} changed files since ${since} affect this app.`);
  }
}

try {
  main();
} catch (error) {
  build(`The Git diff could not be inspected safely (${describeFailure(error)}).`);
}
