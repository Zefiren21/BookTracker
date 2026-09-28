export interface Env {
  DB: D1Database;
  // Worker secrets, set in the Cloudflare dashboard. Never committed.
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  ALLOWED_EMAILS: string; // comma-separated
}
