#!/usr/bin/env node
// Makes the FITX_ADMIN_PASSWORD_HASH value: `npm run admin:hash`, type the password twice (nothing shows),
// copy the one line it prints. The password is never printed, logged or saved. The format matches
// src/lib/password.ts: scrypt:<N>:<r>:<p>:<salt base64url>:<key base64url> (colons, because Next expands
// $NAME in .env files). admin/tests/password.test.mjs checks that its output verifies there.
import { randomBytes, scrypt } from "node:crypto";
import { pathToFileURL } from "node:url";

export const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, keyLength: 64, saltLength: 16, maxmem: 64 * 1024 * 1024 };
export const MIN_ROOT_PASSWORD_LENGTH = 8;
export const RECOMMENDED_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

/** The same hash src/lib/password.ts makes and checks. */
export function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    return Promise.reject(new TypeError(`A password must be 1 to ${MAX_PASSWORD_LENGTH} characters`));
  }
  const { N, r, p, keyLength, saltLength, maxmem } = SCRYPT_PARAMS;
  const salt = randomBytes(saltLength);
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFC"), salt, keyLength, { N, r, p, maxmem }, (error, key) => {
      if (error) reject(error);
      else resolve(`scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${key.toString("base64url")}`);
    });
  });
}

/** Reads one line from a terminal with echo off (raw mode), or one line of piped input. */
function readHidden(prompt, piped) {
  process.stderr.write(prompt);
  if (piped) return Promise.resolve(piped.shift() ?? "");
  return new Promise((resolve) => {
    const input = process.stdin;
    let value = "";
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          input.setRawMode(false);
          process.stderr.write("\n");
          process.exit(130);
        }
        if (char === "\r" || char === "\n" || char === "\u0004") {
          input.setRawMode(false);
          input.pause();
          input.off("data", onData);
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") value = Array.from(value).slice(0, -1).join("");
        else if (char >= " ") value += char;
      }
    };
    input.on("data", onData);
  });
}

async function readPipedLines() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text.split(/\r?\n/);
}

async function main() {
  const piped = process.stdin.isTTY ? null : await readPipedLines();
  const first = await readHidden("Admin password (nothing shows as you type): ", piped);
  const second = await readHidden("Type it again: ", piped);
  if (first !== second) {
    process.stderr.write("The two passwords did not match. Nothing was made.\n");
    process.exit(1);
  }
  const length = Array.from(first).length;
  if (length < MIN_ROOT_PASSWORD_LENGTH || first.length > MAX_PASSWORD_LENGTH) {
    process.stderr.write(`Use ${MIN_ROOT_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters. Nothing was made.\n`);
    process.exit(1);
  }
  if (length < RECOMMENDED_PASSWORD_LENGTH) {
    process.stderr.write(`Note: ${RECOMMENDED_PASSWORD_LENGTH} or more characters is safer.\n`);
  }
  process.stdout.write(`${await hashPassword(first)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write("The hash could not be made.\n");
    process.exit(1);
  });
}
