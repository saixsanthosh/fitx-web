/**
 * Google Identity Services (GIS) for "Sign in with Google": Google's own button, so its consent screen names FITX
 * (the site's origin) instead of the Supabase project address that the redirect flow shows. The button hands back
 * a Google ID token; Supabase verifies it (signInWithIdToken) against the nonce we made for this attempt.
 *
 * Nonce: Google gets the SHA-256 hex of a random value, Supabase gets the value itself and checks that the token's
 * nonce is its hash, so a token can't be replayed into another sign-in.
 *
 * With NEXT_PUBLIC_GOOGLE_CLIENT_ID unset (or malformed), or when Google's script can't load, sign-in keeps the
 * redirect flow (startOAuth in src/components/auth/GoogleButton.tsx). Owner steps: docs/runbooks/google-sign-in.md.
 */

export const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
/** How long Google's script may take before the redirect button takes over. */
export const GIS_LOAD_TIMEOUT_MS = 6000;

/** A Google OAuth web client id (…apps.googleusercontent.com), or null. Same rule as next.config.ts's CSP switch. */
export function googleClientIdFrom(value: string | undefined | null): string | null {
  const text = value?.trim() ?? "";
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(text) ? text : null;
}

/** The configured client id, read at build time (NEXT_PUBLIC_). */
export function configuredGoogleClientId(): string | null {
  return googleClientIdFrom(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
}

const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** SHA-256 of `text` as lower-case hex (what Google puts in the token's nonce claim). */
export async function sha256Hex(text: string, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  return hex(await subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** A fresh nonce pair: `raw` for Supabase, `hashed` for Google. 32 random bytes. */
export async function createNonce(source: Pick<Crypto, "getRandomValues" | "subtle"> = globalThis.crypto): Promise<{ raw: string; hashed: string }> {
  const raw = hex(source.getRandomValues(new Uint8Array(32)));
  return { raw, hashed: await sha256Hex(raw, source.subtle) };
}

/** The part of Google's API the button uses. */
export type GoogleId = {
  initialize(config: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    nonce: string;
    ux_mode?: "popup" | "redirect";
    context?: "signin" | "signup" | "use";
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    itp_support?: boolean;
    use_fedcm_for_button?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: {
    type?: "standard" | "icon";
    theme?: "outline" | "filled_blue" | "filled_black";
    size?: "large" | "medium" | "small";
    text?: "signin_with" | "signup_with" | "continue_with" | "signin";
    shape?: "rectangular" | "pill" | "circle" | "square";
    logo_alignment?: "left" | "center";
    width?: number;
    locale?: string;
  }): void;
  disableAutoSelect(): void;
  cancel(): void;
};

type GoogleWindow = Window & { google?: { accounts?: { id?: GoogleId } } };

let loading: Promise<GoogleId> | null = null;

/** Loads Google's script once and resolves with google.accounts.id; rejects on error or after the timeout. */
export function loadGoogleIdentity(timeoutMs = GIS_LOAD_TIMEOUT_MS): Promise<GoogleId> {
  const w = window as GoogleWindow;
  if (w.google?.accounts?.id) return Promise.resolve(w.google.accounts.id);
  if (loading) return loading;
  loading = new Promise<GoogleId>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    const timer = window.setTimeout(() => done(new Error("Google's sign-in script timed out")), timeoutMs);
    function done(error: Error | null) {
      window.clearTimeout(timer);
      const api = w.google?.accounts?.id;
      if (!error && api) return resolve(api);
      script.remove();
      loading = null;
      reject(error ?? new Error("Google's sign-in script loaded without its API"));
    }
    script.onload = () => done(null);
    script.onerror = () => done(new Error("Google's sign-in script could not load"));
    document.head.appendChild(script);
  });
  return loading;
}

type AuthErrorLike = { message?: string; code?: string; status?: number } | null | undefined;

/**
 * What to tell the member when Supabase refuses Google's token, and whether the redirect flow should take over
 * (a project not set up for this client id can still sign in the old way).
 */
export function idTokenProblem(error: AuthErrorLike): { message: string; fallback: boolean } {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  if (/banned|suspend/i.test(text)) return { message: "", fallback: false };
  if (/not enabled|unsupported provider|audience|client.?id|issuer/i.test(text)) {
    return { message: "Google’s quick sign-in isn’t set up here yet. Use the button again to continue with Google.", fallback: true };
  }
  if (/nonce/i.test(text)) return { message: "That Google sign-in expired. Please try again.", fallback: false };
  if (/fetch|network|failed to connect/i.test(text)) return { message: "We couldn’t connect to FITX. Check your connection and try again.", fallback: false };
  return { message: "We couldn’t complete Google sign-in. Please try again.", fallback: false };
}
