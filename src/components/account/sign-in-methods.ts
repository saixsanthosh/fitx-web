/**
 * Settings > Account > Sign-in methods (bug 27), named from what the account and this session really show.
 *
 * - Every email account can sign in with a code sent to its address: "Email code". An account made with "Email me a
 *   code" has the same email identity as one made with a password, so the identity says nothing about a password.
 * - "Password" is listed only when this session was signed in with one: the access token's amr claim names
 *   "password" (supabase.auth.mfa.getAuthenticatorAssuranceLevel() reads it). After a sign-in by code or Google a
 *   password may still exist, so the row then adds a line saying one still works if it was set, claiming nothing.
 * - Google and Apple come from their identities.
 *
 * No React here, so node tests cover it (tests/account/sign-in-methods.test.ts).
 */

export const EMAIL_CODE = "Email code";
export const PASSWORD = "Password";
export const PASSWORD_NOTE = "If you also set a password, it still works.";

const PROVIDER_NAMES: Readonly<Record<string, string>> = { google: "Google", apple: "Apple" };

type Identity = { provider?: unknown };
type AppMetadata = { provider?: unknown; providers?: unknown } | null | undefined;
/** An amr entry ({ method, timestamp }); a custom access token hook may give plain strings. */
type AmrEntry = { method?: unknown; timestamp?: unknown } | string;

export type SignInMethods = {
  methods: string[];
  /** True when the account has an email identity but this session doesn't show whether it has a password. */
  passwordNote: boolean;
};

/** The account's sign-in providers: its identities, else what its app metadata lists. */
export function accountProviders(identities: readonly Identity[] | null | undefined, appMetadata: AppMetadata): string[] {
  const fromIdentities = (identities ?? []).map((identity) => identity.provider).filter((provider): provider is string => typeof provider === "string" && provider.length > 0);
  if (fromIdentities.length) return [...new Set(fromIdentities)];
  const listed = Array.isArray(appMetadata?.providers) ? appMetadata.providers.filter((provider): provider is string => typeof provider === "string" && provider.length > 0) : [];
  if (listed.length) return [...new Set(listed)];
  return [typeof appMetadata?.provider === "string" && appMetadata.provider ? appMetadata.provider : "email"];
}

/** The methods this session was signed in with (amr), lower case. */
export function sessionMethods(amr: readonly AmrEntry[] | null | undefined): string[] {
  return (amr ?? []).map((entry) => (typeof entry === "string" ? entry : entry?.method)).filter((method): method is string => typeof method === "string").map((method) => method.toLowerCase());
}

const named = (provider: string) => PROVIDER_NAMES[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);

export function signInMethods({ identities, appMetadata, amr }: { identities: readonly Identity[] | null | undefined; appMetadata: AppMetadata; amr: readonly AmrEntry[] | null | undefined }): SignInMethods {
  const providers = accountProviders(identities, appMetadata);
  const email = providers.includes("email");
  const password = email && sessionMethods(amr).includes("password");
  const methods = [
    ...(email ? [EMAIL_CODE] : []),
    ...(password ? [PASSWORD] : []),
    ...providers.filter((provider) => provider !== "email").map(named),
  ];
  return { methods: [...new Set(methods)], passwordNote: email && !password };
}
