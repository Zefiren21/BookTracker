// Single home for tunable settings (thresholds, quotas, source priority, auth).

export const config = {
  auth: {
    sessionCookie: "session",
    stateCookie: "oauth_state",
    sessionTtlSeconds: 60 * 60 * 24 * 30, // 30 days
    stateTtlSeconds: 60 * 10,
  },
} as const;
