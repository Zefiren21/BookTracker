import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { isAllowed } from "../src/auth/allowlist";
import { signSession, verifySession } from "../src/auth/session";

const SECRET = "test-secret";
const baseEnv = {
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "csecret",
  SESSION_SECRET: SECRET,
  ALLOWED_EMAILS: "Owner@Example.com, friend@example.com",
  DB: {
    prepare: () => ({ bind: () => ({ first: async () => ({ id: 7 }) }) }),
  },
} as any;

const fakeIdToken = (claims: object) => `x.${btoa(JSON.stringify(claims))}.y`;
const mockGoogle = (claims: object) =>
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id_token: fakeIdToken(claims) })));

afterEach(() => vi.unstubAllGlobals());

describe("allowlist", () => {
  it("is case-insensitive and rejects strangers", () => {
    expect(isAllowed("owner@example.com", baseEnv)).toBe(true);
    expect(isAllowed("stranger@example.com", baseEnv)).toBe(false);
    expect(isAllowed("x@example.com", { ALLOWED_EMAILS: "" })).toBe(false);
  });
});

describe("session cookie", () => {
  it("round-trips, and rejects tampering, wrong secret and expiry", async () => {
    const t = await signSession({ uid: 1, email: "a@b.c", exp: 2000 }, SECRET);
    expect((await verifySession(t, SECRET, 1000))?.uid).toBe(1);
    expect(await verifySession(t, "other", 1000)).toBeNull();
    expect(await verifySession(t + "x", SECRET, 1000)).toBeNull();
    expect(await verifySession(t, SECRET, 3000)).toBeNull();
    expect(await verifySession(undefined, SECRET)).toBeNull();
  });
});

describe("routes", () => {
  it("rejects /api/me without a session", async () => {
    expect((await app.request("/api/me", {}, baseEnv)).status).toBe(401);
  });

  it("accepts /api/me with a valid session, and rejects once removed from allowlist", async () => {
    const exp = Math.floor(Date.now() / 1000) + 100;
    const t = await signSession({ uid: 7, email: "friend@example.com", exp }, SECRET);
    const headers = { cookie: `session=${t}` };
    const ok = await app.request("/api/me", { headers }, baseEnv);
    expect(await ok.json()).toEqual({ id: 7, email: "friend@example.com" });
    const removed = await app.request("/api/me", { headers }, { ...baseEnv, ALLOWED_EMAILS: "owner@example.com" });
    expect(removed.status).toBe(401);
  });

  it("login redirects to Google and sets a state cookie", async () => {
    const res = await app.request("https://x.dev/auth/login", {}, baseEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("accounts.google.com");
    expect(res.headers.get("location")).toContain(encodeURIComponent("https://x.dev/auth/callback"));
    expect(res.headers.get("set-cookie")).toContain("oauth_state=");
  });

  it("callback rejects a mismatched state", async () => {
    const res = await app.request(
      "https://x.dev/auth/callback?code=c&state=bad",
      { headers: { cookie: "oauth_state=good" } },
      baseEnv,
    );
    expect(res.status).toBe(400);
  });

  it("callback creates a session for an allowed, verified email", async () => {
    mockGoogle({ aud: "cid", email: "friend@example.com", email_verified: true, name: "F" });
    const res = await app.request(
      "https://x.dev/auth/callback?code=c&state=s",
      { headers: { cookie: "oauth_state=s" } },
      baseEnv,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toContain("session=");
  });

  it("callback refuses emails not on the list, unverified emails and wrong audience", async () => {
    const hit = () =>
      app.request("https://x.dev/auth/callback?code=c&state=s", { headers: { cookie: "oauth_state=s" } }, baseEnv);
    mockGoogle({ aud: "cid", email: "stranger@example.com", email_verified: true });
    expect((await hit()).status).toBe(403);
    mockGoogle({ aud: "cid", email: "friend@example.com", email_verified: false });
    expect((await hit()).status).toBe(403);
    mockGoogle({ aud: "other", email: "friend@example.com", email_verified: true });
    expect((await hit()).status).toBe(502);
  });

  it("reports not-configured instead of crashing", async () => {
    const res = await app.request("/auth/login", {}, { ...baseEnv, GOOGLE_CLIENT_ID: "" });
    expect(res.status).toBe(503);
  });
});
