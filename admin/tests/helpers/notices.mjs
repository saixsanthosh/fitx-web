// Reading the result a Server Action sealed into the address it redirects to (src/lib/notice.ts).
import { importTypeScriptModule } from "./typescript-module.mjs";

const { openNotice } = await importTypeScriptModule("src/lib/notice.ts");

/** A redirect with a sealed result: the address without it, and the result as `binding` (the operator's ID) opens it. */
export function sealedRedirect(url, binding, param = "notice") {
  const parsed = new URL(url, "https://admin.invalid");
  const token = parsed.searchParams.get(param);
  parsed.searchParams.delete(param);
  return { path: `${parsed.pathname}${parsed.search}${parsed.hash}`, notice: openNotice(token, binding) };
}
