import type { Env } from "../env";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleProfile {
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export function buildAuthUrl(env: Pick<Env, "GOOGLE_CLIENT_ID">, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `${AUTH_URL}?${p}`;
}

// The id_token comes straight from Google's token endpoint over TLS in exchange
// for our client secret, so decoding without a signature check is permitted by
// the OpenID Connect spec. We still check the audience.
export async function exchangeCode(
  env: Pick<Env, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET">,
  code: string,
  redirectUri: string,
): Promise<GoogleProfile> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("Google response had no id_token");

  const part = id_token.split(".")[1] ?? "";
  const claims = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as {
    aud?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new Error("id_token audience mismatch");
  if (!claims.email) throw new Error("id_token had no email");
  return { email: claims.email, emailVerified: claims.email_verified === true, name: claims.name ?? null };
}
