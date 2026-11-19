/** Pages in the (auth) group that draw their own one-screen frame (AuthScreen) instead of the photo frame. */
export const OWN_SCREEN_PATHS: readonly string[] = ["/signin", "/signup", "/forgot-password", "/reset-password"];

export function drawsOwnScreen(pathname: string | null): boolean {
  return pathname !== null && OWN_SCREEN_PATHS.includes(pathname.replace(/\/+$/, "") || "/");
}
