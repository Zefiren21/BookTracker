import type { Env } from "../env";

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

// The one place the friends-only allowlist is checked. Going public later
// means changing this function, nothing else.
export function isAllowed(email: string, env: Pick<Env, "ALLOWED_EMAILS">): boolean {
  const allowed = (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map(normaliseEmail)
    .filter(Boolean);
  return allowed.includes(normaliseEmail(email));
}
