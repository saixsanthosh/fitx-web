import { readFile } from "node:fs/promises";
import ts from "typescript";

/**
 * Loads a dependency-free TypeScript module from admin/ for `node --test`, using the
 * project's own TypeScript compiler. It needs no build step and no Node type stripping,
 * so it works on every supported Node version. Modules with runtime imports cannot be
 * loaded this way; keep the logic under test in import-free files.
 */
export async function importTypeScriptModule(pathFromAdminRoot) {
  const url = new URL(`../../${pathFromAdminRoot}`, import.meta.url);
  const source = await readFile(url, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: url.pathname,
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
