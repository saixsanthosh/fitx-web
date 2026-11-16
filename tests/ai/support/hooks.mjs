// Lets the coach's server modules load under `node --test`:
//  - `import "server-only"` (which Next resolves itself) becomes an empty module;
//  - JSON data files (imported without import attributes, as the bundler allows) load as modules.
// Import this file first, then load app modules with a dynamic `await import(...)`.
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".json") && url.includes("/src/data/")) {
      return { format: "module", source: `export default ${readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
