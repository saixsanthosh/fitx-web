import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";
import * as script from "../scripts/hash-password.mjs";

// Made-up passwords only. The owner's real password is never written anywhere.
const SAMPLE = "made-up correct horse 42";

const { SCRYPT_PARAMS, MIN_PASSWORD_LENGTH, hashPassword, verifyPassword, parsePasswordHash } = await importTypeScriptModule("src/lib/password.ts");

test("the scrypt parameters are the contract's", () => {
  assert.deepEqual({ ...SCRYPT_PARAMS }, { N: 32768, r: 8, p: 1, keyLength: 64, saltLength: 16, maxmem: 64 * 1024 * 1024 });
  assert.deepEqual(script.SCRYPT_PARAMS, { ...SCRYPT_PARAMS });
  assert.equal(MIN_PASSWORD_LENGTH, 12);
});

test("a hash has the colon format, a fresh salt each time, and verifies only its own password", async () => {
  const first = await hashPassword(SAMPLE);
  const second = await hashPassword(SAMPLE);
  assert.match(first, /^scrypt:32768:8:1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{86}$/);
  assert.doesNotMatch(first, /\$/, "no $: Next would expand it in .env files");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(SAMPLE, first), true);
  assert.equal(await verifyPassword(SAMPLE, second), true);
  assert.equal(await verifyPassword(`${SAMPLE} `, first), false);
  assert.equal(await verifyPassword("made-up wrong guess", first), false);
  assert.equal(await verifyPassword("", first), false);
  assert.equal(await verifyPassword(undefined, first), false);
});

test("admin:hash makes hashes that src/lib/password.ts verifies", async () => {
  const hash = await script.hashPassword(SAMPLE);
  assert.match(hash, /^scrypt:32768:8:1:/);
  assert.equal(await verifyPassword(SAMPLE, hash), true);
  assert.equal(await verifyPassword("made-up other words", hash), false);
});

test("malformed or out-of-range stored hashes never verify", async () => {
  const good = await hashPassword(SAMPLE);
  const [, , , , salt, key] = good.split(":");
  const bad = [
    null,
    undefined,
    42,
    "",
    "plain-text-password",
    good.replaceAll(":", "$"),
    `scrypt:16384:8:1:${salt}:${key}`, // N below 2^15
    `scrypt:2097152:8:1:${salt}:${key}`, // N above 2^20
    `scrypt:40000:8:1:${salt}:${key}`, // N not a power of two
    `scrypt:32768:16:1:${salt}:${key}`, // r must be 8
    `scrypt:32768:8:5:${salt}:${key}`, // p above 4
    `scrypt:32768:8:0:${salt}:${key}`,
    `scrypt:32768:8:1:${salt.slice(0, -2)}:${key}`, // short salt
    `scrypt:32768:8:1:${salt}:${key.slice(0, -4)}`, // short key
    `scrypt:32768:8:1:${salt}=:${key}`, // padding is not canonical base64url
    `bcrypt:32768:8:1:${salt}:${key}`,
    `${good}:extra`,
  ];
  for (const stored of bad) {
    assert.equal(parsePasswordHash(stored), null, String(stored));
    assert.equal(await verifyPassword(SAMPLE, stored), false, String(stored));
  }
  assert.ok(parsePasswordHash(good));
});

test("a longer cost (N 2^16, p 2) is accepted when verifying", async () => {
  const { scrypt, randomBytes } = await import("node:crypto");
  const salt = randomBytes(16);
  const key = await new Promise((resolve, reject) =>
    scrypt(SAMPLE, salt, 64, { N: 65536, r: 8, p: 2, maxmem: 256 * 1024 * 1024 }, (error, derived) => (error ? reject(error) : resolve(derived))),
  );
  const stored = `scrypt:65536:8:2:${salt.toString("base64url")}:${key.toString("base64url")}`;
  assert.equal(await verifyPassword(SAMPLE, stored), true);
});

test("hashPassword refuses empty and oversized input", async () => {
  await assert.rejects(hashPassword(""));
  await assert.rejects(hashPassword("x".repeat(257)));
  await assert.rejects(script.hashPassword(""));
});

function runScript(input) {
  const file = fileURLToPath(new URL("../scripts/hash-password.mjs", import.meta.url));
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [file], { timeout: 20_000 }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }));
    child.stdin.end(input);
  });
}

test("npm run admin:hash prints only the hash line, never the password", async () => {
  const result = await runScript(`${SAMPLE}\n${SAMPLE}\n`);
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split("\n").filter(Boolean);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^scrypt:32768:8:1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{86}$/);
  assert.equal(await verifyPassword(SAMPLE, lines[0]), true);
  assert.ok(!result.stdout.includes(SAMPLE) && !result.stderr.includes(SAMPLE));
});

test("admin:hash refuses a mismatch and fewer than 8 characters, and notes under 12", async () => {
  const mismatch = await runScript(`${SAMPLE}\nmade-up different\n`);
  assert.equal(mismatch.code, 1);
  assert.equal(mismatch.stdout, "");
  assert.match(mismatch.stderr, /did not match/);

  const short = await runScript("short1\nshort1\n");
  assert.equal(short.code, 1);
  assert.equal(short.stdout, "");

  const medium = await runScript("made-up9x\nmade-up9x\n");
  assert.equal(medium.code, 0);
  assert.match(medium.stderr, /12 or more characters/);
  assert.match(medium.stdout, /^scrypt:/);
});
