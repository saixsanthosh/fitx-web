// Review security:R3-SEC-1: the bug-42 line "You’re signed out everywhere, including this device." came from the address
// alone, so any link to /signin?signed_out=everywhere made FITX's own sign-in page say every device was signed out,
// although nothing had been revoked. The proxy sends a signed-in member on from /signin, so the line reached exactly the
// people a lure would aim at: a member signed out on this device, told by a mail that "we've secured your account", who
// then had no reason to press Sign out everywhere themselves. Now the address alone says only "signed out on this
// device" (true for everyone the proxy shows the page to); the stronger line also needs the proof this browser's own
// Sign out everywhere leaves (a short-lived cookie a link can't set), read once and removed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ADDRESS_ERRORS,
  addressError,
  addressNotice,
  noticeProofCookie,
  SETUP_MISSING,
  SIGNED_OUT_EVERYWHERE,
  SIGNED_OUT_HERE,
  signedOutAddress,
  signedOutProof,
  takeNoticeProof,
} from "@/lib/auth/address-messages";
import { NOTICE_PROOF_COOKIE, noticeProofCookieOptions } from "@/lib/auth/cookies";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const search = (address: string) => new URL(address, "https://fitnessx.vercel.app").search;

/**
 * A browser's cookies as page scripts see them, shared by every page the browser opens: writing "name=value; attributes"
 * to a page's document.cookie sets one cookie (Max-Age=0 removes it); reading lists the name=value pairs.
 */
function browser(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  const writes: string[] = [];
  /** A new page (its own document) in this browser. */
  const page = () => ({
    get cookie() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set cookie(text: string) {
      writes.push(text);
      const [pair, ...attributes] = text.split(";").map((part) => part.trim());
      const at = pair.indexOf("=");
      if (attributes.some((attribute) => /^max-age=0$/i.test(attribute))) jar.delete(pair.slice(0, at));
      else jar.set(pair.slice(0, at), pair.slice(at + 1));
    },
  });
  return { jar, writes, page };
}

test("a link can't make the sign-in page say every device is signed out", () => {
  // A browser that holds no proof (the lure's case): no cookies, other cookies, or a value FITX never writes.
  const withoutProof: Record<string, string>[] = [{}, { fitx_auth: "1", other: "everywhere" }, { [NOTICE_PROOF_COOKIE]: "bogus" }, { [NOTICE_PROOF_COOKIE]: "" }];
  for (const address of ["/signin?signed_out=everywhere", "/signin?signed_out=everywhere&next=%2Fdashboard", "/signin?next=%2Fsettings&signed_out=everywhere"]) {
    assert.equal(addressNotice(search(address)), SIGNED_OUT_HERE, `${address}: the address alone says this device only`);
    for (const cookies of withoutProof) {
      const proof = takeNoticeProof(browser(cookies).page(), true);
      assert.equal(proof, null, JSON.stringify(cookies));
      assert.equal(addressNotice(search(address), proof), SIGNED_OUT_HERE, `${address} with ${JSON.stringify(cookies)}`);
      assert.notEqual(addressNotice(search(address), proof), SIGNED_OUT_EVERYWHERE);
    }
  }
});

test("after this browser's own Sign out everywhere the page says so", () => {
  const { page } = browser();
  // What LogoutButton does once the sign-out worked, then where it lands.
  page().cookie = noticeProofCookie("everywhere", true);
  const signIn = page();
  const proof = takeNoticeProof(signIn, true);
  assert.equal(proof, "everywhere");
  assert.equal(addressNotice(search(signedOutAddress("global")), proof), SIGNED_OUT_EVERYWHERE);
  // The proof speaks for that sign-out only, never for Log out's address.
  assert.equal(addressNotice(search(signedOutAddress("local")), proof), SIGNED_OUT_HERE);
  assert.equal(addressNotice("", proof), "", "no ?signed_out=, no notice");
});

test("the proof is read once per page, then removed, so a reload or a later link gets the plain line", () => {
  const { jar, writes, page } = browser();
  page().cookie = noticeProofCookie("everywhere", true);
  const signIn = page();
  assert.equal(takeNoticeProof(signIn, true), "everywhere");
  assert.equal(jar.has(NOTICE_PROOF_COOKIE), false, "gone as soon as it is read");
  assert.match(writes.at(-1) ?? "", new RegExp(`^${NOTICE_PROOF_COOKIE}=; Path=/signin; Max-Age=0; SameSite=Lax; Secure$`));
  // React asks again while the page shows (and twice in development): the same answer, and no second removal.
  const removals = writes.length;
  assert.equal(takeNoticeProof(signIn, true), "everywhere");
  assert.equal(writes.length, removals);
  // A reload, or a link opened afterwards in this browser, is a new page: nothing to prove it any more.
  const later = page();
  assert.equal(takeNoticeProof(later, true), null);
  assert.equal(addressNotice(search(signedOutAddress("global")), takeNoticeProof(later, true)), SIGNED_OUT_HERE);
  assert.equal(writes.length, removals, "no cookie, nothing written");
});

test("the proof cookie: the sign-in page only, two minutes, readable by that page, Secure on HTTPS", () => {
  assert.equal(noticeProofCookie("everywhere", true), `${NOTICE_PROOF_COOKIE}=everywhere; Path=/signin; Max-Age=120; SameSite=Lax; Secure`);
  assert.equal(noticeProofCookie("everywhere", false), `${NOTICE_PROOF_COOKIE}=everywhere; Path=/signin; Max-Age=120; SameSite=Lax`);
  assert.deepEqual(noticeProofCookieOptions(true), { path: "/signin", sameSite: "lax", secure: true, httpOnly: false, maxAge: 120 });
  assert.equal(NOTICE_PROOF_COOKIE, "fitx_signin_notice");
});

test("only a Sign out everywhere that worked leaves the proof, after the account is forgotten, just before the page changes", () => {
  const button = read("src/components/app/LogoutButton.tsx");
  assert.match(
    button,
    /if \(outcome === "cancelled"\) \{[\s\S]*?return;\s*\}\s*if \(outcome === "failed"\) \{[\s\S]*?return;\s*\}\s*forgetAccountInBrowser\(\);[\s\S]*?const proof = signedOutProof\(scope, outcome\);\s*if \(proof\) document\.cookie = noticeProofCookie\(proof, secure\);\s*window\.location\.replace\(signedOutAddress\(scope, outcome\)\);/,
  );
  assert.equal(button.match(/noticeProofCookie\(/g)?.length, 1, "nowhere else");
  assert.match(button, /const secure = window\.location\.protocol === "https:";/);
  // Log out leaves none: its line claims this device only.
  assert.equal(signedOutProof("local", "signed_out"), null);
  assert.equal(signedOutProof("global", "signed_out"), "everywhere");
});

test("the sign-in page reads the proof once per page and needs it for the stronger line", () => {
  const form = read("src/app/(auth)/signin/SignInForm.tsx");
  assert.match(form, /const noticeProof = \(\) => takeNoticeProof\(document, window\.location\.protocol === "https:"\);/);
  assert.match(form, /const getLocationNotice = \(\) => addressNotice\(window\.location\.search, noticeProof\(\)\);/);
  // Read after hydration only: the server's draw (and the hydration render) has no notice.
  assert.match(form, /useSyncExternalStore\(subscribeLocation, getLocationNotice, \(\) => ""\)/);
});

// The same mistake elsewhere on the page: ?setup= made FITX's own page say "Account access is not configured in this
// environment yet." wherever a link sent it, sign-in working or not. The page knows its own configuration, so it says
// that only where Supabase really is unset.
test("a link can't make a working sign-in page say sign-in isn't set up", () => {
  for (const address of ["/signin?setup=supabase", "/signin?setup=1&next=%2Fdashboard"]) {
    assert.equal(addressError(search(address)), "", `${address}: the address alone`);
    assert.equal(addressError(search(address), true), "", `${address} where Supabase is set up`);
    assert.equal(addressError(search(address), false), SETUP_MISSING, `${address} where it isn't (the proxy's own redirect)`);
  }
  // The known ?error= lines are unchanged either way (they are about the sign-in that came back).
  for (const code of Object.keys(ADDRESS_ERRORS)) assert.equal(addressError(`?error=${code}`, true), ADDRESS_ERRORS[code], code);
  const form = read("src/app/(auth)/signin/SignInForm.tsx");
  assert.match(form, /const getLocationError = \(\) => addressError\(window\.location\.search, isSupabaseConfigured\);/);
});
