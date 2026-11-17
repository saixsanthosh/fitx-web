/*
 * The device id (activities.client_id) of an imported activity: a UUID made from a SHA-256 of
 * "import:" + the time of its first GPS point to the second. Every export of one session (its FIT,
 * its GPX, a re-download) shares that moment, so importing it again in any format finds the same
 * row through the unique (user_id, client_id) and saves nothing twice. The sport is left out, so a
 * session imported again with another sport still matches.
 */

/** The moment an import is identified by: its first point, whole seconds. */
export function fingerprintSecond(firstPointMs: number): number {
  return Math.floor(firstPointMs / 1000);
}

export async function importClientId(firstPointMs: number): Promise<string> {
  const data = new TextEncoder().encode(`import:${fingerprintSecond(firstPointMs)}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const bytes = digest.slice(0, 16);
  // RFC 9562 layout: version 8 (custom, here SHA-256 based) and the standard variant.
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
