const STAMP_KEY = "fitx-session-stamped";
const STAMP_EVERY_MS = 10 * 60 * 1000;

/**
 * Asks the server to re-send the current session cookies. Safari keeps cookies written by page
 * scripts for only seven days; written by the server they last as long as the session itself.
 */
export function stampSessionCookies() {
  try {
    window.sessionStorage.setItem(STAMP_KEY, String(Date.now()));
  } catch {}
  return fetch("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent: "refresh" }),
    credentials: "same-origin",
    keepalive: true,
  }).then(() => undefined, () => undefined);
}

export function stampedRecently() {
  try {
    return Date.now() - Number(window.sessionStorage.getItem(STAMP_KEY) ?? 0) < STAMP_EVERY_MS;
  } catch {
    return false;
  }
}
