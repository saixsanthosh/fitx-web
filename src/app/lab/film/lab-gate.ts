/** The lab page opens only in development and only when the server was started with FITX_LAB=1. */
export function labEnabled(env: { NODE_ENV?: string; FITX_LAB?: string }): boolean {
  return env.NODE_ENV !== "production" && env.FITX_LAB === "1";
}
