// The Supabase Storage part of the e2e stand-in. Object rows live in the database's storage.objects, written
// and read as the caller's role (the bucket policies from the migrations decide), and the bytes in a
// folder on disk. Covers what FITX uses: upload, signed URLs (one or many), downloads, list and remove.
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { lit } from "./pg-wire.mjs";
import { signJwt, verifyJwt } from "./jwt.mjs";

const storageError = (status, statusCode, error, message) => ({ status, body: { statusCode: String(statusCode), error, message } });

export class StorageService {
  constructor({ pool, dir, secret, transaction }) {
    this.pool = pool;
    this.dir = dir;
    this.secret = secret;
    this.transaction = transaction; // (ctx) => tx with run(statements) / finish(commit) / abort()
    mkdirSync(dir, { recursive: true });
  }

  fileFor(bucket, name) {
    return path.join(this.dir, encodeURIComponent(bucket), encodeURIComponent(name));
  }

  async bucket(id) {
    return this.pool.json(`select row_to_json(b)::text from storage.buckets b where b.id = ${lit(id)}`);
  }

  /** Runs statements as the caller's role; returns rows of each result, or { error } with the Postgres error. */
  async asRole(ctx, statements) {
    const tx = this.transaction(ctx);
    try {
      const rows = await tx.run(statements, { readOnly: false });
      await tx.finish(true);
      return { rows };
    } catch (error) {
      await tx.abort();
      return { error };
    }
  }

  async handle(request, ctx) {
    const { method, route, query, body, rawBody, headers } = request;
    const segments = route.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));

    if (segments[0] === "bucket" && method === "GET") {
      if (segments[1]) {
        const bucket = await this.bucket(segments[1]);
        return bucket ? { status: 200, body: bucket } : storageError(400, 404, "Bucket not found", "Bucket not found");
      }
      return { status: 200, body: await this.pool.json(`select coalesce(json_agg(b), '[]'::json)::text from storage.buckets b`) };
    }
    if (segments[0] !== "object") return storageError(404, 404, "not_found", `e2e stand-in: no Storage route for ${method} ${route}`);

    const [, first, ...rest] = segments;
    if (first === "sign") {
      const [bucketId, ...nameParts] = rest;
      const name = nameParts.join("/");
      if (method === "GET") return this.download(bucketId, name, query, { token: query.get("token") });
      if (method !== "POST") return storageError(405, 405, "method_not_allowed", "Method not allowed");
      const expiresIn = Math.max(1, Number(body?.expiresIn ?? 60));
      if (!name) {
        const paths = Array.isArray(body?.paths) ? body.paths.map(String) : [];
        const found = await this.asRole(ctx, [`select coalesce(json_agg(name), '[]'::json)::text from storage.objects where bucket_id = ${lit(bucketId)} and name = any(${lit(`{${paths.map((p) => `"${p.replace(/["\\]/g, "\\$&")}"`).join(",")}}`)}::text[])`]);
        if (found.error) return storageError(400, 400, "invalid", found.error.message);
        const visible = new Set(JSON.parse(found.rows[0][0][0]));
        return {
          status: 200,
          body: paths.map((item) => visible.has(item)
            ? { error: null, path: item, signedURL: this.signedPath(bucketId, item, expiresIn) }
            : { error: "Either the object does not exist or you do not have access to it", path: item, signedURL: null }),
        };
      }
      const found = await this.asRole(ctx, [`select count(*)::text from storage.objects where bucket_id = ${lit(bucketId)} and name = ${lit(name)}`]);
      if (found.error) return storageError(400, 400, "invalid", found.error.message);
      if (found.rows[0][0][0] === "0") return storageError(400, 404, "not_found", "Object not found");
      return { status: 200, body: { signedURL: this.signedPath(bucketId, name, expiresIn) } };
    }

    if (first === "public" && method === "GET") {
      const [bucketId, ...nameParts] = rest;
      const bucket = await this.bucket(bucketId);
      if (!bucket?.public) return storageError(400, 404, "not_found", "Object not found");
      return this.download(bucketId, nameParts.join("/"), query, { trusted: true });
    }

    if (first === "list" && method === "POST") return this.list(rest[0], body ?? {}, ctx);

    const authenticated = first === "authenticated";
    const [bucketId, ...nameParts] = authenticated ? rest : [first, ...rest];
    const name = nameParts.join("/");

    if (method === "DELETE" && !name) {
      const prefixes = Array.isArray(body?.prefixes) ? body.prefixes.map(String) : [];
      const removed = await this.asRole(ctx, [`with d as (delete from storage.objects where bucket_id = ${lit(bucketId)} and name = any(${lit(`{${prefixes.map((p) => `"${p.replace(/["\\]/g, "\\$&")}"`).join(",")}}`)}::text[]) returning *) select coalesce(json_agg(d), '[]'::json)::text from d`]);
      if (removed.error) return storageError(400, 400, "invalid", removed.error.message);
      const rows = JSON.parse(removed.rows[0][0][0]);
      for (const row of rows) rmSync(this.fileFor(bucketId, row.name), { force: true });
      return { status: 200, body: rows };
    }

    if (method === "GET" && name) {
      const visible = await this.asRole(ctx, [`select count(*)::text from storage.objects where bucket_id = ${lit(bucketId)} and name = ${lit(name)}`]);
      if (visible.error || visible.rows[0][0][0] === "0") return storageError(400, 404, "not_found", "Object not found");
      return this.download(bucketId, name, query, { trusted: true });
    }

    if ((method === "POST" || method === "PUT") && name) return this.upload(bucketId, name, { method, headers, rawBody }, ctx);

    return storageError(404, 404, "not_found", `e2e stand-in: no Storage route for ${method} ${route}`);
  }

  signedPath(bucket, name, expiresIn) {
    const iat = Math.floor(Date.now() / 1000);
    const token = signJwt({ url: `${bucket}/${name}`, iat, exp: iat + expiresIn }, this.secret);
    return `/object/sign/${bucket}/${name}?token=${token}`;
  }

  async download(bucketId, name, query, { token, trusted = false }) {
    if (!trusted) {
      const verified = verifyJwt(token ?? "", this.secret);
      if (verified.error === "expired") return storageError(400, 400, "InvalidJWT", "\"exp\" claim timestamp check failed");
      if (verified.error || verified.claims.url !== `${bucketId}/${name}`) return storageError(400, 400, "InvalidSignature", "The signature is invalid");
    }
    const row = await this.pool.json(`select row_to_json(o)::text from storage.objects o where bucket_id = ${lit(bucketId)} and name = ${lit(name)}`);
    const file = this.fileFor(bucketId, name);
    if (!row || !existsSync(file)) return storageError(400, 404, "not_found", "Object not found");
    const headers = {
      "content-type": row.metadata?.mimetype ?? "application/octet-stream",
      "cache-control": row.metadata?.cacheControl ?? "no-cache",
      etag: row.metadata?.eTag ?? "",
    };
    if (query.has("download")) {
      const fileName = query.get("download") || name.split("/").pop();
      headers["content-disposition"] = `attachment; filename="${fileName.replace(/"/g, "")}"`;
    }
    return { status: 200, headers, raw: readFileSync(file) };
  }

  async upload(bucketId, name, { method, headers, rawBody }, ctx) {
    const bucket = await this.bucket(bucketId);
    if (!bucket) return storageError(400, 404, "Bucket not found", "Bucket not found");
    if (name.split("/").some((part) => part === ".." || part === "")) return storageError(400, 400, "InvalidKey", `Invalid key: ${name}`);
    let bytes = rawBody;
    let mimetype = String(headers["content-type"] ?? "application/octet-stream").split(";")[0];
    let cacheControl = String(headers["cache-control"] ?? "max-age=3600");
    if (/^multipart\/form-data/i.test(String(headers["content-type"] ?? ""))) {
      const form = await new Response(rawBody, { headers: { "content-type": headers["content-type"] } }).formData();
      const file = form.get("") ?? [...form.values()].find((value) => typeof value === "object" && value !== null && "arrayBuffer" in value);
      if (!file) return storageError(400, 400, "InvalidRequest", "No file in the form");
      bytes = Buffer.from(await file.arrayBuffer());
      mimetype = file.type || "application/octet-stream";
      const cache = form.get("cacheControl");
      if (typeof cache === "string") cacheControl = `max-age=${cache}`;
    }
    if (Array.isArray(bucket.allowed_mime_types) && bucket.allowed_mime_types.length && !bucket.allowed_mime_types.includes(mimetype)) {
      return storageError(400, 415, "invalid_mime_type", `mime type ${mimetype} is not supported`);
    }
    if (bucket.file_size_limit && bytes.length > Number(bucket.file_size_limit)) {
      return storageError(413, 413, "Payload too large", "The object exceeded the maximum allowed size");
    }
    const upsert = method === "PUT" || String(headers["x-upsert"] ?? "false") === "true";
    const eTag = `"${createHash("md5").update(bytes).digest("hex")}"`;
    const metadata = { eTag, size: bytes.length, mimetype, cacheControl, lastModified: new Date().toUTCString(), contentLength: bytes.length, httpStatusCode: 200 };
    const owner = ctx.claims?.sub ?? null;
    const values = `(${lit(bucketId)}, ${lit(name)}, ${owner ? lit(owner) : "null"}, ${owner ? lit(owner) : "null"}, ${lit(JSON.stringify(metadata))}::jsonb, gen_random_uuid()::text)`;
    const statement = method === "PUT"
      ? `with u as (update storage.objects set metadata = ${lit(JSON.stringify(metadata))}::jsonb, updated_at = now(), version = gen_random_uuid()::text where bucket_id = ${lit(bucketId)} and name = ${lit(name)} returning id) select coalesce(json_agg(u.id), '[]'::json)::text from u`
      : `with i as (insert into storage.objects (bucket_id, name, owner, owner_id, metadata, version) values ${values}${upsert ? " on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now(), version = excluded.version, owner = excluded.owner, owner_id = excluded.owner_id" : ""} returning id) select coalesce(json_agg(i.id), '[]'::json)::text from i`;
    const result = await this.asRole(ctx, [statement]);
    if (result.error) {
      if (result.error.code === "23505") return storageError(400, 409, "Duplicate", "The resource already exists");
      if (result.error.code === "42501") return storageError(400, 403, "Unauthorized", "new row violates row-level security policy");
      return storageError(400, 400, "InvalidRequest", result.error.message);
    }
    const ids = JSON.parse(result.rows[0][0][0]);
    if (!ids.length) return storageError(400, 404, "not_found", "Object not found");
    const file = this.fileFor(bucketId, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return { status: 200, body: { Id: ids[0], Key: `${bucketId}/${name}` } };
  }

  async list(bucketId, options, ctx) {
    const prefix = String(options.prefix ?? "").replace(/^\/+|\/+$/g, "");
    const folder = prefix ? `${prefix}/` : "";
    const found = await this.asRole(ctx, [`select coalesce(json_agg(json_build_object('name', name, 'id', id, 'updated_at', updated_at, 'created_at', created_at, 'last_accessed_at', last_accessed_at, 'metadata', metadata)), '[]'::json)::text
      from storage.objects where bucket_id = ${lit(bucketId)} and left(name, ${folder.length}) = ${lit(folder)}`]);
    if (found.error) return storageError(400, 400, "invalid", found.error.message);
    const entries = new Map();
    for (const object of JSON.parse(found.rows[0][0][0])) {
      const restName = object.name.slice(folder.length);
      const slash = restName.indexOf("/");
      if (slash >= 0) {
        const child = restName.slice(0, slash);
        if (!entries.has(child)) entries.set(child, { name: child, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
      } else {
        entries.set(restName, { ...object, name: restName });
      }
    }
    const search = String(options.search ?? "").toLowerCase();
    const column = ["name", "updated_at", "created_at", "last_accessed_at"].includes(options.sortBy?.column) ? options.sortBy.column : "name";
    const descending = options.sortBy?.order === "desc";
    const listed = [...entries.values()]
      .filter((entry) => !search || entry.name.toLowerCase().startsWith(search))
      .sort((a, b) => String(a[column] ?? "").localeCompare(String(b[column] ?? "")) * (descending ? -1 : 1));
    const offset = Math.max(0, Number(options.offset ?? 0));
    const limit = Math.max(0, Number(options.limit ?? 100));
    return { status: 200, body: listed.slice(offset, offset + limit) };
  }
}
