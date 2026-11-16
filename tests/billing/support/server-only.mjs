// Next.js resolves `import "server-only"` itself; plain Node does not. Billing tests import this first and
// then load app modules with dynamic import(), so the marker resolves to an empty module.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true, format: "module" };
    return nextResolve(specifier, context);
  },
});
