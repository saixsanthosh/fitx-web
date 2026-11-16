// Path rules for the two Vercel projects that build from this repository.
// FITX, the customer site, lives at the repository root; FITX Admin lives in admin/.
// Pure functions only, so they can be tested without Git. The Vercel entry point is
// vercel-ignore.mjs.

export const TARGETS = Object.freeze(["fitx", "admin"]);

const ADMIN_DIRECTORY = "admin";

// Paths outside admin/ that can change how Admin installs or builds. A root
// package.json can declare npm workspaces, for example, which changes how admin/
// installs. FITX lives at the repository root, so every path outside admin/,
// these included, already rebuilds FITX: shared paths therefore build both apps.
const SHARED_DIRECTORIES = ["packages/", "shared/"];
const SHARED_ROOT_FILES = new Set(["package.json", "package-lock.json", ".npmrc", "tsconfig.base.json"]);

export function normalizePath(filePath) {
  return String(filePath).replaceAll("\\", "/").replace(/^\.\//, "");
}

/** Parses `git diff --name-status -z`. Renames and copies keep both the old and the new path. */
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

export function isAdminPath(file) {
  return file === ADMIN_DIRECTORY || file.startsWith(`${ADMIN_DIRECTORY}/`);
}

export function isSharedPath(file) {
  return SHARED_ROOT_FILES.has(file) || SHARED_DIRECTORIES.some((prefix) => file.startsWith(prefix));
}

export function affectsTarget(target, file) {
  if (target === "fitx") return !isAdminPath(file);
  if (target === "admin") return isAdminPath(file) || isSharedPath(file);
  return true;
}

/** The changed paths that matter to one app. */
export function relevantFiles(target, changedFiles) {
  return changedFiles.map(normalizePath).filter(Boolean).filter((file) => affectsTarget(target, file));
}

/**
 * Decides from the changed paths. An unknown target builds. An empty list also builds:
 * it means a redeploy of the same commit or an empty commit, never "nothing to do".
 */
export function shouldBuild(target, changedFiles) {
  if (!TARGETS.includes(target)) return true;
  const files = changedFiles.map(normalizePath).filter(Boolean);
  if (files.length === 0) return true;
  return files.some((file) => affectsTarget(target, file));
}
