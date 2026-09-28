// Stateless signed session cookie (HMAC-SHA256 via WebCrypto: very cheap on CPU).

export interface Session {
  uid: number;
  email: string;
  exp: number; // unix seconds
}

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signSession(session: Session, secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(session)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(
  token: string | undefined,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<Session | null> {
  if (!token || !secret) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), unb64url(sig), enc.encode(payload));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(unb64url(payload))) as Session;
    if (typeof s.uid !== "number" || typeof s.email !== "string" || typeof s.exp !== "number") return null;
    return s.exp > now ? s : null;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 16): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
