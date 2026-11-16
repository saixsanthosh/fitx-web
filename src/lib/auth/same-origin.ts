/** True only for requests sent by this site's own pages (fetch metadata, or the Origin header as a fallback). */
export function isSameOriginRequest(request: { headers: { get(name: string): string | null }; nextUrl: { origin: string } }) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  return request.headers.get("origin") === request.nextUrl.origin;
}
