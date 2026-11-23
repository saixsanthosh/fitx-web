# Google sign-in that names FITX

With the redirect flow, Google's account chooser says "to continue to jcksfjmfptcfusqknevx.supabase.co", because
Google sends the visitor back to Supabase's own address. A custom Supabase domain (fitnessx.supabase.co) would
change that, but it needs a paid Supabase plan, so it is not done.

The free fix is Google's own button, Google Identity Services (GIS), on fitnessx.vercel.app. Google's screen then
names the site that shows the button (FITX), and no redirect to Supabase happens at all.

## How it works

1. The sign-in and sign-up pages load `https://accounts.google.com/gsi/client` only when
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set, and draw Google's "Continue with Google" button
   (`src/components/auth/GoogleSignIn.tsx`).
2. For each attempt the page makes a random nonce. Google receives its SHA-256 hex and puts it in the ID token;
   Supabase receives the raw value in `supabase.auth.signInWithIdToken({ provider: "google", token, nonce })` and
   checks that the token's nonce is its hash, so a token can't be replayed into another sign-in.
3. The page then calls `/api/auth/session` exactly like a password or code sign-in, so the session cookies, the
   onboarding redirect, the account's film and the returning-login logo reveal (`fitx_welcome`) behave as before.
4. Fallbacks: no client id (or a malformed one), Google's script blocked or slow (6 s), or Supabase not accepting
   this client id yet: the page shows the familiar redirect button instead (`startOAuth`), so sign-in never breaks.
5. The Content-Security-Policy gains Google's documented entries only when the client id is set
   (`next.config.ts`): `https://accounts.google.com/gsi/client` in `script-src`, and `https://accounts.google.com/gsi/`
   in `frame-src`, `connect-src` and `style-src`. Nothing else changes.

## Owner steps (in this order; an agent never types keys into a website)

1. **Google Cloud Console** → APIs & Services → Credentials → the OAuth 2.0 **Web application** client that Supabase
   already uses for Google sign-in (or a new web client).
   - **Authorised JavaScript origins**: add `https://fitnessx.vercel.app` (and `http://localhost:3000` if you
     want to try it locally). No trailing slash.
   - Keep the existing **Authorised redirect URI** (`https://jcksfjmfptcfusqknevx.supabase.co/auth/v1/callback`):
     the redirect button still uses it as the fallback.
   - OAuth consent screen: the app name **FITX**, the logo, the support email and the home page
     `https://fitnessx.vercel.app` are what Google shows on its screen.
2. **Supabase** → Authentication → Sign In / Providers → Google: make sure the provider is enabled and that the
   web client id from step 1 is in **Client IDs** (the authorised client ids list; with several, separate them by
   commas). Leave "Skip nonce checks" **off**: FITX sends a nonce.
3. **Vercel** → the fitx-web project → Settings → Environment Variables: add `NEXT_PUBLIC_GOOGLE_CLIENT_ID` = that
   client id (it is public by design) for Production (and Preview if wanted), then **redeploy**: the value and the
   CSP entries are fixed at build time.

## Check

- Open https://fitnessx.vercel.app/signin in a private window: Google's own button shows (Google's "G" in a dark
  button in the light theme, a white one in the dark theme). Choosing an account names FITX, not the Supabase
  address, and you land on the dashboard (or onboarding for a new account).
- The browser console shows no Content-Security-Policy errors for accounts.google.com.
- If the button still shows the plain FITX-styled "Continue with Google", the variable is not in that build
  (redeploy) or is not a `…apps.googleusercontent.com` id.
- "Google's quick sign-in isn't set up here yet": Supabase rejected the client id (step 2); the redirect button
  is shown and still works.

## Undo

Remove `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in Vercel and redeploy: the redirect flow and the previous CSP come back.
