// The Supabase Auth (GoTrue) part of the e2e stand-in, on the real auth schema of the throwaway database:
// sign-up creates an auth.users row (so the FITX triggers that create profiles run) and an identity, every
// sign-in is an auth.sessions row with its AMR claim and rotating refresh tokens, and deleting a user
// cascades through every table that references auth.users. E-mail sign-up is auto-confirmed (no mail is
// sent) and OAuth providers are not enabled, as on a project without them.
// E-mail one-time codes (POST /otp, POST /verify with type "email") behave as on Supabase: a 6-digit code,
// one request a minute per address, codes expire, a wrong code is otp_expired. Instead of mailing it the
// stand-in keeps the last code per address in an outbox the flows read with the service-role key:
// GET /auth/v1/__e2e/outbox?email=<address> → { code, sentAt } (404 when nothing was sent).
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { lit } from "./pg-wire.mjs";
import { signJwt, verifyJwt } from "./jwt.mjs";

const INSTANCE = "00000000-0000-0000-0000-000000000000";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const OTP_RESEND_SECONDS = 60;
const OTP_TTL_SECONDS = 3600;
const OTP_MAX_TRIES = 5;

const authError = (status, errorCode, msg, extra = {}) => ({ status, body: { code: status, error_code: errorCode, msg, ...extra } });

export class AuthService {
  constructor({ pool, issuer, secret, accessTtl = 3600, reuseInterval = 10 }) {
    this.pool = pool;
    this.issuer = issuer;
    this.secret = secret;
    this.accessTtl = accessTtl;
    this.reuseInterval = reuseInterval;
    /** address → { code, sentAt, expiresAt, tries }: the e-mail one-time codes "sent" (see the header). */
    this.outbox = new Map();
  }

  /** POST /otp for an e-mail address: makes and "sends" a code, creating the user when create_user allows. */
  async sendOtp(body) {
    const address = String(body?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(address)) return authError(400, "validation_failed", "Unable to validate email address: invalid format");
    const last = this.outbox.get(address);
    const waited = last ? (Date.now() - last.sentAt) / 1000 : Infinity;
    if (waited < OTP_RESEND_SECONDS) {
      const left = Math.ceil(OTP_RESEND_SECONDS - waited);
      return authError(429, "over_email_send_rate_limit", `For security purposes, you can only request this after ${left} seconds.`);
    }
    const id = await this.pool.value(`select id from auth.users where lower(email) = ${lit(address)} and deleted_at is null`);
    if (!id) {
      if (body?.create_user === false) return authError(422, "otp_disabled", "Signups not allowed for otp");
      const created = await this.createUser({ email: address, password: randomBytes(18).toString("base64url"), data: body?.data ?? {} });
      if (created.error) return created.error;
    }
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    this.outbox.set(address, { code, sentAt: Date.now(), expiresAt: Date.now() + OTP_TTL_SECONDS * 1000, tries: 0 });
    return { status: 200, body: {} };
  }

  /** POST /verify with type email: a right, unexpired code signs in once; anything else is otp_expired. */
  async verifyOtp(body, request) {
    const address = String(body?.email ?? "").trim().toLowerCase();
    if (!["email", "magiclink", "signup"].includes(body?.type)) return authError(400, "validation_failed", "Verify requires a verification type");
    const sent = this.outbox.get(address);
    const expired = authError(403, "otp_expired", "Token has expired or is invalid");
    if (!sent || sent.used || Date.now() > sent.expiresAt) return expired;
    if (String(body?.token ?? "") !== sent.code) {
      sent.tries += 1;
      if (sent.tries >= OTP_MAX_TRIES) sent.used = true;
      return expired;
    }
    sent.used = true;
    const id = await this.pool.value(`select id from auth.users where lower(email) = ${lit(address)} and deleted_at is null`);
    if (!id) return expired;
    return { status: 200, body: await this.startSession(id, "otp", request) };
  }

  userJsonSql(where) {
    return `select json_build_object(
      'id', u.id, 'aud', coalesce(u.aud, 'authenticated'), 'role', coalesce(u.role, 'authenticated'), 'email', u.email,
      'email_confirmed_at', u.email_confirmed_at, 'phone', coalesce(u.phone, ''), 'confirmed_at', u.confirmed_at,
      'last_sign_in_at', u.last_sign_in_at, 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb),
      'user_metadata', coalesce(u.raw_user_meta_data, '{}'::jsonb),
      'identities', coalesce((select json_agg(json_build_object('identity_id', i.id, 'id', i.provider_id, 'user_id', i.user_id,
          'identity_data', i.identity_data, 'provider', i.provider, 'last_sign_in_at', i.last_sign_in_at,
          'created_at', i.created_at, 'updated_at', i.updated_at, 'email', i.email)) from auth.identities i where i.user_id = u.id), '[]'::json),
      'created_at', u.created_at, 'updated_at', u.updated_at, 'is_anonymous', u.is_anonymous, 'banned_until', u.banned_until
    )::text from auth.users u where ${where}`;
  }

  user(id) {
    return this.pool.json(this.userJsonSql(`u.id = ${lit(id)}`));
  }

  /** Verified claims of a bearer token, or an Auth error response. */
  claimsOf(token) {
    const verified = verifyJwt(token, this.secret);
    if (verified.error === "expired") return { error: authError(403, "bad_jwt", "invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired") };
    if (verified.error) return { error: authError(403, "bad_jwt", "invalid JWT: unable to parse or verify signature, signature is invalid") };
    return { claims: verified.claims };
  }

  async accessToken(user, sessionId) {
    const amr = await this.pool.json(`select coalesce(json_agg(json_build_object('method', authentication_method, 'timestamp', floor(extract(epoch from updated_at))::bigint) order by updated_at desc), '[]'::json)::text from auth.mfa_amr_claims where session_id = ${lit(sessionId)}`);
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + this.accessTtl;
    const token = signJwt({
      aud: "authenticated", exp, iat, iss: this.issuer, sub: user.id, email: user.email, phone: user.phone ?? "",
      app_metadata: user.app_metadata, user_metadata: user.user_metadata, role: "authenticated", aal: "aal1",
      amr, session_id: sessionId, is_anonymous: false,
    }, this.secret);
    return { token, iat, exp };
  }

  async sessionResponse(userId, sessionId, refreshToken) {
    const user = await this.user(userId);
    const access = await this.accessToken(user, sessionId);
    return {
      access_token: access.token, token_type: "bearer", expires_in: this.accessTtl, expires_at: access.exp,
      refresh_token: refreshToken, user,
    };
  }

  async startSession(userId, method, request) {
    const sessionId = randomUUID();
    const refreshToken = randomBytes(18).toString("base64url");
    const agent = String(request.headers["user-agent"] ?? "").slice(0, 200);
    await this.pool.exec(`
      insert into auth.sessions (id, user_id, created_at, updated_at, aal, user_agent, ip) values (${lit(sessionId)}, ${lit(userId)}, now(), now(), 'aal1', ${lit(agent)}, '127.0.0.1');
      insert into auth.mfa_amr_claims (session_id, created_at, updated_at, authentication_method, id) values (${lit(sessionId)}, now(), now(), ${lit(method)}, gen_random_uuid());
      insert into auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at, parent, session_id)
        values (${lit(INSTANCE)}, ${lit(refreshToken)}, ${lit(userId)}, false, now(), now(), null, ${lit(sessionId)});
      update auth.users set last_sign_in_at = now(), updated_at = now() where id = ${lit(userId)};
      update auth.identities set last_sign_in_at = now(), updated_at = now() where user_id = ${lit(userId)};`);
    return this.sessionResponse(userId, sessionId, refreshToken);
  }

  /** Creates a confirmed e-mail user; returns its id or an Auth error response. */
  async createUser({ email, password, data = {}, appMetadata = {} }) {
    const address = String(email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(address)) return { error: authError(400, "validation_failed", "Unable to validate email address: invalid format") };
    if (String(password ?? "").length < 6) {
      return { error: authError(422, "weak_password", "Password should be at least 6 characters.", { weak_password: { reasons: ["length"] } }) };
    }
    const exists = await this.pool.value(`select 1 from auth.users where lower(email) = ${lit(address)}`);
    if (exists) return { error: authError(422, "user_already_exists", "User already registered") };
    const id = randomUUID();
    const userMetadata = { ...data, email: address, email_verified: true, phone_verified: false, sub: id };
    const identityData = { email: address, email_verified: false, phone_verified: false, sub: id };
    await this.pool.exec(`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token, recovery_token,
        email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at, is_sso_user, is_anonymous)
      values (${lit(INSTANCE)}, ${lit(id)}, 'authenticated', 'authenticated', ${lit(address)}, extensions.crypt(${lit(password)}, extensions.gen_salt('bf', 6)),
        now(), '', '', '', '', ${lit(JSON.stringify({ provider: "email", providers: ["email"], ...appMetadata }))}::jsonb,
        ${lit(JSON.stringify(userMetadata))}::jsonb, false, now(), now(), false, false);
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (${lit(id)}, ${lit(id)}, ${lit(JSON.stringify(identityData))}::jsonb, 'email', now(), now(), now());`);
    return { id };
  }

  async handle(request) {
    const { method, route, query, body, bearer } = request;

    if (route === "/settings" && method === "GET") {
      return { status: 200, body: { external: { email: true, phone: false, google: false, apple: false, github: false }, disable_signup: false, mailer_autoconfirm: true, phone_autoconfirm: false, sms_provider: "", saml_enabled: false } };
    }
    if (route === "/health" && method === "GET") return { status: 200, body: { version: "fitx-e2e", name: "GoTrue", description: "e2e stand-in" } };
    if (route === "/.well-known/jwks.json" && method === "GET") return { status: 200, body: { keys: [] } };

    if (route === "/signup" && method === "POST") {
      const created = await this.createUser({ email: body?.email, password: body?.password, data: body?.data ?? {} });
      if (created.error) return created.error;
      return { status: 200, body: await this.startSession(created.id, "password", request) };
    }

    if (route === "/token" && method === "POST") {
      const grant = query.get("grant_type");
      if (grant === "password") {
        const address = String(body?.email ?? "").trim().toLowerCase();
        const id = await this.pool.value(`select id from auth.users where lower(email) = ${lit(address)} and deleted_at is null
          and encrypted_password = extensions.crypt(${lit(String(body?.password ?? ""))}, encrypted_password)`);
        if (!id) return authError(400, "invalid_credentials", "Invalid login credentials");
        return { status: 200, body: await this.startSession(id, "password", request) };
      }
      if (grant === "refresh_token") return this.refresh(String(body?.refresh_token ?? ""));
      if (grant === "pkce") return authError(404, "flow_state_not_found", "invalid flow state, no valid flow state found");
      return authError(400, "unsupported_grant_type", "unsupported_grant_type");
    }

    if (route === "/authorize" && method === "GET") {
      return authError(400, "validation_failed", "Unsupported provider: provider is not enabled");
    }
    if (route === "/otp" && method === "POST" && body?.email !== undefined) return this.sendOtp(body);
    if (route === "/verify" && method === "POST") return this.verifyOtp(body, request);
    if (route === "/__e2e/outbox" && method === "GET") {
      const { claims, error } = this.claimsOf(bearer);
      if (error) return error;
      if (claims.role !== "service_role") return authError(403, "not_admin", "User not allowed");
      const sent = this.outbox.get(String(query.get("email") ?? "").trim().toLowerCase());
      if (!sent) return authError(404, "not_found", "No code sent to that address");
      return { status: 200, body: { code: sent.code, sentAt: new Date(sent.sentAt).toISOString() } };
    }
    if ((route === "/recover" || route === "/otp" || route === "/resend" || route === "/magiclink") && method === "POST") {
      return { status: 200, body: {} }; // Nothing is mailed by the stand-in.
    }

    if (route === "/user") {
      const checked = await this.currentUser(bearer);
      if (checked.error) return checked.error;
      if (method === "GET") return { status: 200, body: checked.user };
      if (method === "PUT") {
        const updates = [];
        if (body?.data && typeof body.data === "object") updates.push(`raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || ${lit(JSON.stringify(body.data))}::jsonb`);
        if (typeof body?.password === "string") {
          if (body.password.length < 6) return authError(422, "weak_password", "Password should be at least 6 characters.");
          updates.push(`encrypted_password = extensions.crypt(${lit(body.password)}, extensions.gen_salt('bf', 6))`);
        }
        if (typeof body?.email === "string") updates.push(`email = ${lit(body.email.trim().toLowerCase())}`);
        if (updates.length) await this.pool.exec(`update auth.users set ${updates.join(", ")}, updated_at = now() where id = ${lit(checked.user.id)}`);
        return { status: 200, body: await this.user(checked.user.id) };
      }
    }

    if (route === "/logout" && method === "POST") {
      const { claims } = this.claimsOf(bearer);
      if (!claims?.session_id) return { status: 204 };
      const scope = query.get("scope") ?? "global";
      if (scope === "local") await this.pool.exec(`delete from auth.sessions where id = ${lit(claims.session_id)}`);
      else if (scope === "others") await this.pool.exec(`delete from auth.sessions where user_id = ${lit(claims.sub)} and id <> ${lit(claims.session_id)}`);
      else await this.pool.exec(`delete from auth.sessions where user_id = ${lit(claims.sub)}`);
      return { status: 204 };
    }

    const admin = /^\/admin\/users(?:\/([0-9a-f-]{36}))?$/.exec(route);
    if (admin) {
      const { claims, error } = this.claimsOf(bearer);
      if (error) return error;
      if (claims.role !== "service_role") return authError(403, "not_admin", "User not allowed");
      const id = admin[1];
      if (!id && method === "GET") {
        const page = Math.max(1, Number(query.get("page") ?? 1));
        const perPage = Math.min(1000, Math.max(1, Number(query.get("per_page") ?? 50)));
        const users = await this.pool.json(`select coalesce(json_agg(x.u order by x.created_at), '[]'::json)::text from (
          select (${this.userJsonSql("u.id = o.id")})::json as u, o.created_at from auth.users o order by o.created_at limit ${perPage} offset ${(page - 1) * perPage}) x`);
        return { status: 200, body: { users, aud: "authenticated" } };
      }
      if (!id && method === "POST") {
        const created = await this.createUser({ email: body?.email, password: body?.password ?? randomBytes(12).toString("base64url"), data: body?.user_metadata ?? {}, appMetadata: body?.app_metadata ?? {} });
        if (created.error) return created.error;
        return { status: 200, body: await this.user(created.id) };
      }
      const existing = id ? await this.user(id) : null;
      if (!existing) return authError(404, "user_not_found", "User not found");
      if (method === "GET") return { status: 200, body: existing };
      if (method === "DELETE") {
        await this.pool.exec(`delete from auth.users where id = ${lit(id)}`);
        return { status: 200, body: {} };
      }
      if (method === "PUT") {
        if (body?.user_metadata) await this.pool.exec(`update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || ${lit(JSON.stringify(body.user_metadata))}::jsonb, updated_at = now() where id = ${lit(id)}`);
        if (body?.app_metadata) await this.pool.exec(`update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || ${lit(JSON.stringify(body.app_metadata))}::jsonb, updated_at = now() where id = ${lit(id)}`);
        if (body?.ban_duration === "none") await this.pool.exec(`update auth.users set banned_until = null where id = ${lit(id)}`);
        return { status: 200, body: await this.user(id) };
      }
    }

    return { status: 404, body: { code: 404, error_code: "not_found", msg: `e2e stand-in: no Auth route for ${method} ${route}` } };
  }

  /** The signed-in user for a bearer token, as GET /auth/v1/user checks it (signature, expiry, session, user). */
  async currentUser(bearer) {
    const { claims, error } = this.claimsOf(bearer);
    if (error) return { error };
    if (claims.role !== "authenticated" || !claims.sub) return { error: authError(403, "bad_jwt", "invalid claim: missing sub claim") };
    if (claims.session_id) {
      const live = await this.pool.value(`select 1 from auth.sessions where id = ${lit(claims.session_id)}`);
      if (!live) return { error: authError(403, "session_not_found", "Session from session_id claim in JWT does not exist") };
    }
    const user = await this.user(claims.sub);
    if (!user) return { error: authError(403, "user_not_found", "User from sub claim in JWT does not exist") };
    return { user, claims };
  }

  async refresh(token) {
    const row = await this.pool.json(`select json_build_object('id', r.id, 'user_id', r.user_id, 'revoked', r.revoked, 'session_id', r.session_id,
        'revoked_ago', extract(epoch from (now() - r.updated_at)), 'session_live', s.id is not null)::text
      from auth.refresh_tokens r left join auth.sessions s on s.id = r.session_id where r.token = ${lit(token)}`);
    if (!row || !row.session_live) return authError(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
    if (row.revoked && row.revoked_ago > this.reuseInterval) {
      // Reuse outside the allowed interval: GoTrue treats it as a stolen token and ends the whole session.
      await this.pool.exec(`update auth.refresh_tokens set revoked = true, updated_at = now() where session_id = ${lit(row.session_id)} and not revoked`);
      return authError(400, "refresh_token_already_used", "Invalid Refresh Token: Already Used");
    }
    const next = randomBytes(18).toString("base64url");
    await this.pool.exec(`
      update auth.refresh_tokens set revoked = true, updated_at = case when revoked then updated_at else now() end where id = ${row.id};
      insert into auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at, parent, session_id)
        values (${lit(INSTANCE)}, ${lit(next)}, ${lit(row.user_id)}, false, now(), now(), ${lit(token)}, ${lit(row.session_id)});
      update auth.sessions set refreshed_at = now() at time zone 'utc', updated_at = now() where id = ${lit(row.session_id)};`);
    return { status: 200, body: await this.sessionResponse(row.user_id, row.session_id, next) };
  }
}
