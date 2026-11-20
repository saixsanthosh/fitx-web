import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ADMIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

/** admin/-relative path of an `@/…` or relative TypeScript import, or null for packages and node: builtins. */
function resolveLocal(specifier, fromFile) {
  let base;
  if (specifier.startsWith("@/")) base = resolve(ADMIN_ROOT, "src", specifier.slice(2));
  else if (specifier.startsWith("./") || specifier.startsWith("../")) base = resolve(dirname(fromFile), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot resolve ${specifier} from ${fromFile}`);
}

async function load(file, stubs, cache, nonce) {
  if (cache.has(file)) return cache.get(file);
  const promise = (async () => {
    const source = await readFile(file, "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    });
    // The compiler's own scan finds the import and export specifiers (with their positions), so text that
    // merely looks like an import inside code or strings is left alone.
    const imported = ts.preProcessFile(outputText, true, true).importedFiles;
    const specifiers = [...new Set(imported.map((entry) => entry.fileName))];
    const replacements = new Map();
    for (const specifier of specifiers) {
      if (specifier === "server-only") replacements.set(specifier, dataUrl(`/* ${nonce} */ export {};`));
      else if (Object.hasOwn(stubs, specifier)) replacements.set(specifier, dataUrl(`/* ${nonce} */\n${stubs[specifier]}`));
      else {
        const local = resolveLocal(specifier, file);
        if (local) replacements.set(specifier, await load(local, stubs, cache, nonce));
        else if (!specifier.startsWith("node:")) throw new Error(`${file} imports ${specifier}: pass a stub for it`);
      }
    }
    let rewritten = outputText;
    for (const entry of [...imported].sort((left, right) => right.pos - left.pos)) {
      const replacement = replacements.get(entry.fileName);
      if (!replacement) continue;
      // The reported position may sit on the opening quote; find the specifier itself next to it.
      const start = [entry.pos, entry.pos + 1, entry.pos - 1].find((at) => rewritten.slice(at, at + entry.fileName.length) === entry.fileName);
      if (start === undefined) throw new Error(`cannot place import ${entry.fileName} in ${file}`);
      rewritten = `${rewritten.slice(0, start)}${replacement}${rewritten.slice(start + entry.fileName.length)}`;
    }
    return dataUrl(`/* ${nonce} */\n${rewritten}`);
  })();
  cache.set(file, promise);
  return promise;
}

/**
 * Loads a TypeScript module from admin/ for `node --test`, using the project's own TypeScript compiler,
 * with no build step and no Node type stripping. Its `@/…` and relative imports are loaded the same
 * way, `import "server-only"` is dropped, and node: builtins load as usual. Any other import (next/*,
 * react, @supabase/*) needs a stub: `stubs` maps the specifier to the source of a small ES module.
 * Each call loads fresh copies, so module state never leaks between tests that pass different stubs.
 */
let loads = 0;
export async function importTypeScriptModule(pathFromAdminRoot, stubs = {}) {
  loads += 1;
  const url = await load(resolve(ADMIN_ROOT, pathFromAdminRoot), stubs, new Map(), `load ${loads}`);
  return import(url);
}
