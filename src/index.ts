import { Hono } from "hono";

const app = new Hono();

// Placeholder to confirm the first deploy works. Replaced by the real app in Phase 1.
app.get("/", (c) => c.text("BookTracker is alive"));
app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
