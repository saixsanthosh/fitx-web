export function getAdminSiteOrigin() {
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.ADMIN_SITE_URL) {
    try {
      return new URL(process.env.ADMIN_SITE_URL).origin;
    } catch {
      return null;
    }
  }
  if (process.env.NODE_ENV !== "production") return "http://localhost:3100";
  return null;
}
