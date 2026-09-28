import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { config } from "../config";
import type { Env } from "../env";
import { isAllowed, normaliseEmail } from "./allowlist";
import { buildAuthUrl, exchangeCode } from "./google";
import { randomToken, signSession, verifySession, type Session } from "./session";

export type AppEnv = { Bindings: Env; Variables: { user: Session } };

const cookieBase = { httpOnly: true, secure: true, sameSite: "Lax", path: "/" } as const;

function configured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET);
}

export const auth = new Hono<AppEnv>();

auth.get("/login", (c) => {
  if (!configured(c.env)) return c.text("Sign-in is not configured yet.", 503);
  const state = randomToken();
  setCookie(c, config.auth.stateCookie, state, { ...cookieBase, maxAge: config.auth.stateTtlSeconds });
  const redirectUri = new URL(c.req.url).origin + "/auth/callback";
  return c.redirect(buildAuthUrl(c.env, redirectUri, state));
});

auth.get("/callback", async (c) => {
  if (!configured(c.env)) return c.text("Sign-in is not configured yet.", 503);
  const expected = getCookie(c, config.auth.stateCookie);
  deleteCookie(c, config.auth.stateCookie, { path: "/" });
  const state = c.req.query("state");
  const code = c.req.query("code");
  if (!expected || !state || state !== expected || !code) {
    return c.text("Sign-in failed: invalid or expired request. Please try again.", 400);
  }

  let profile;
  try {
    profile = await exchangeCode(c.env, code, new URL(c.req.url).origin + "/auth/callback");
  } catch (e) {
    console.error("auth callback error:", (e as Error).message);
    return c.text("Sign-in failed. Please try again.", 502);
  }

  const email = normaliseEmail(profile.email);
  if (!profile.emailVerified || !isAllowed(email, c.env)) {
    return c.text("Sorry, this account is not on the invite list.", 403);
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO users (email, display_name) VALUES (?1, ?2)
     ON CONFLICT(email) DO UPDATE SET display_name = COALESCE(excluded.display_name, users.display_name)
     RETURNING id`,
  )
    .bind(email, profile.name)
    .first<{ id: number }>();
  if (!row) return c.text("Sign-in failed. Please try again.", 500);

  const exp = Math.floor(Date.now() / 1000) + config.auth.sessionTtlSeconds;
  const token = await signSession({ uid: row.id, email, exp }, c.env.SESSION_SECRET);
  setCookie(c, config.auth.sessionCookie, token, { ...cookieBase, maxAge: config.auth.sessionTtlSeconds });
  return c.redirect("/");
});

auth.post("/logout", (c) => {
  deleteCookie(c, config.auth.sessionCookie, { path: "/" });
  return c.redirect("/", 303);
});

// Attach the signed-in user or reject. The allowlist is re-checked on every
// request so removing a friend takes effect immediately.
export const requireUser = async (c: any, next: () => Promise<void>) => {
  const session = await verifySession(getCookie(c, config.auth.sessionCookie), c.env.SESSION_SECRET);
  if (!session || !isAllowed(session.email, c.env)) return c.json({ error: "unauthorised" }, 401);
  c.set("user", session);
  await next();
};
