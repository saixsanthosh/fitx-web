// Preloaded into `next start` by the e2e runner (NODE_OPTIONS=--import=<this file>): the app server may only
// talk to this machine. A request to any other host (Open Food Facts, USDA, AI providers, Razorpay...) fails
// the way it does when the network is down (getaddrinfo ENOTFOUND), so features have to degrade honestly,
// and it is recorded in E2E_OUTBOUND_LOG (method, origin and path only, never the query string).
import { appendFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

const LOG = process.env.E2E_OUTBOUND_LOG;

function isLocal(host) {
  const name = String(host ?? "").replace(/^\[|\]$/g, "").replace(/:\d+$/, "").toLowerCase();
  return name === "" || name === "localhost" || name.endsWith(".localhost") || name === "127.0.0.1" || name === "::1";
}

function record(kind, method, url) {
  if (!LOG) return;
  try {
    appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), kind, method, target: `${url.protocol}//${url.host}${url.pathname}`.slice(0, 400) })}\n`);
  } catch {
    // Recording is best effort.
  }
}

const notFound = (hostname) => Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND", errno: -3008, syscall: "getaddrinfo", hostname });

const realFetch = globalThis.fetch;
globalThis.fetch = async function e2eFetch(input, init) {
  let url = null;
  try {
    url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  } catch {
    return realFetch(input, init);
  }
  if (!isLocal(url.hostname)) {
    record("fetch", String(init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase(), url);
    throw new TypeError("fetch failed", { cause: notFound(url.hostname) });
  }
  return realFetch(input, init);
};

function deny(hostname, options, callback) {
  const done = typeof options === "function" ? options : callback;
  process.nextTick(done, notFound(hostname));
}

for (const [library, protocol] of [[http, "http:"], [https, "https:"]]) {
  const original = library.request;
  const request = function e2eRequest(...args) {
    const [target] = args;
    let url = null;
    if (typeof target === "string" || target instanceof URL) url = new URL(target);
    else if (target && typeof target === "object") url = new URL(`${target.protocol ?? protocol}//${target.hostname ?? target.host ?? "localhost"}${target.path ?? "/"}`);
    if (url && !isLocal(url.hostname)) {
      record("http", String((typeof args[1] === "object" && args[1]?.method) || target?.method || "GET").toUpperCase(), url);
      if (typeof target === "string" || target instanceof URL) {
        const options = typeof args[1] === "object" && args[1] !== null ? { ...args[1], lookup: deny } : { lookup: deny };
        const rest = typeof args[1] === "function" ? [args[1]] : args.slice(2);
        return original.call(this, target, options, ...rest);
      }
      return original.call(this, { ...target, lookup: deny }, ...args.slice(1));
    }
    return original.apply(this, args);
  };
  library.request = request;
  library.get = function e2eGet(...args) {
    const req = request(...args);
    req.end();
    return req;
  };
}
