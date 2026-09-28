import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { config } from "./config";
import { auth, requireUser, type AppEnv } from "./auth/routes";
import { isAllowed } from "./auth/allowlist";
import { verifySession } from "./auth/session";

const app = new Hono<AppEnv>();

app.route("/auth", auth);

app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/me", requireUser, (c) => {
  const { uid, email } = c.get("user");
  return c.json({ id: uid, email });
});

// Temporary landing page to prove sign-in works. Replaced by the React app.
app.get("/", async (c) => {
  const s = await verifySession(getCookie(c, config.auth.sessionCookie), c.env.SESSION_SECRET);
  const user = s && isAllowed(s.email, c.env) ? s : null;
  const body = user
    ? `<p>Signed in as <b>${user.email.replace(/[<>&"]/g, "")}</b></p>
       <form method="post" action="/auth/logout"><button>Sign out</button></form>`
    : `<p><a href="/auth/login"><button>Sign in with Google</button></a></p>`;
  return c.html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BookTracker</title><body style="font-family:system-ui;padding:2rem"><h1>BookTracker</h1>${body}</body>`);
});

export default app;
