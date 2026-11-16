// Lets `node --test` load the app's TypeScript modules directly (Node 24 strips types itself):
//  - "@/x" resolves to src/x, like the tsconfig path alias;
//  - extensionless relative imports get .ts / index.ts, like the bundler resolution Next uses;
//  - bare "next/<subpath>" gets its .js file, since Next's package has no exports map for them.
// Only .ts modules can be tested this way (no JSX), and type-only imports must use `import type`.
import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "src");

function withExtension(file) {
  if (existsSync(file) && statSync(file).isFile()) return file;
  for (const ext of [".ts", ".mts", ".js", ".mjs"]) if (existsSync(file + ext)) return file + ext;
  for (const index of ["index.ts", "index.js"]) {
    const candidate = path.join(file, index);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = withExtension(path.join(SRC, specifier.slice(2)));
      if (target) return nextResolve(pathToFileURL(target).href, context);
    }
    const relative = specifier.startsWith("./") || specifier.startsWith("../");
    const ownCode = context.parentURL?.startsWith("file:") && !context.parentURL.includes("/node_modules/");
    if (relative && ownCode && !path.extname(specifier)) {
      const target = withExtension(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
      if (target) return nextResolve(pathToFileURL(target).href, context);
    }
    if (/^next\/[a-z-]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
    return nextResolve(specifier, context);
  },
});
