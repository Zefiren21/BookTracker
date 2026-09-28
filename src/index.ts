import { Hono } from "hono";
import { auth, requireUser, type AppEnv } from "./auth/routes";

const app = new Hono<AppEnv>();

app.route("/auth", auth);

app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/me", requireUser, (c) => {
  const { uid, email } = c.get("user");
  return c.json({ id: uid, email });
});

export default app;
