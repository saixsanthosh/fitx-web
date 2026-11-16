import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ADMIN_PREFIX = "admin/";
const SHARED_PREFIXES = ["packages/", "shared/"];
const SHARED_ROOT_FILES = new Set([
  "package.json",
  "package-lock.json",
  ".npmrc",
  "tsconfig.base.json",
]);

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function parseNameStatusZ(output) {
  const tokens = output.split("\0").filter(Boolean);
  const files = [];

  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (/^[RC]/.test(status)) {
      const oldPath = tokens[index++];
      const newPath = tokens[index++];
      if (oldPath) files.push(normalizePath(oldPath));
      if (newPath) files.push(normalizePath(newPath));
    } else {
      const filePath = tokens[index++];
      if (filePath) files.push(normalizePath(filePath));
    }
  }

  return files;
}

export function shouldBuild(target, changedFiles) {
  if (target !== "fitx" && target !== "admin") return true;
  const files = changedFiles.map(normalizePath).filter(Boolean);
  if (files.length === 0) return false;

  if (target === "fitx") {
    // FITX lives at the repository root, so only an Admin-only diff is skipped.
    return files.some((file) => file !== "admin" && !file.startsWith(ADMIN_PREFIX));
  }

  return files.some((file) =>
    file === "admin" ||
    file.startsWith(ADMIN_PREFIX) ||
    SHARED_ROOT_FILES.has(file) ||
    SHARED_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
}

function run() {
  const target = process.argv[2];
  const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
  const current = process.env.VERCEL_GIT_COMMIT_SHA;

  // Fail open: missing metadata or a git error must run the build, never skip it.
  if ((target !== "fitx" && target !== "admin") || !previous || !current) {
    console.log("Build requested: missing or invalid deployment comparison context.");
    process.exit(1);
  }

  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const output = execFileSync("git", ["diff", "--name-status", "-z", previous, current, "--"], {
      encoding: "utf8",
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const files = parseNameStatusZ(output);
    const build = shouldBuild(target, files);
    console.log(build ? `Building ${target}: relevant files changed.` : `Skipping ${target}: no relevant files changed.`);
    process.exit(build ? 1 : 0);
  } catch {
    console.log("Build requested: unable to inspect the Git diff safely.");
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run();
}
