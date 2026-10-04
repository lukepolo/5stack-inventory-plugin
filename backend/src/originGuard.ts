// Which browser origins may act as a signed-in player here — the CSRF guard.
//
// Identity is the panel's session cookie (identity.ts), which the browser
// attaches by itself. Until this existed, CORS reflected EVERY origin with
// credentials, so any page a player opened could read their inventory, and any
// page an administrator opened could craft, equip, or write shared art as them.
// SameSite=Lax was the only thing in the way, and only in production — the
// panel sets SameSite=None in dev, and devIdentity() makes a cookieless request
// an administrator there.
//
// The rule mirrors the 5stack API's own isAllowedOrigin (api/src/utilities):
//
//  - THIS HOST, and any PARENT DOMAIN of it. That is the panel in every
//    working deployment, with no configuration: the session cookie is scoped to
//    `.${WEB_DOMAIN}`, so the plugin only ever receives it on a subdomain of the
//    panel (see the panel's inventory ingress.yaml). inventory.5stack.gg is
//    reached from 5stack.gg; a page on some-other.5stack.gg is not let in.
//  - Anything the operator names, for layouts outside that: WEB_DOMAIN and
//    AUTH_COOKIE_DOMAIN (the API's own variables — anything https inside the
//    cookie's scope), FIVESTACK_PANEL_URL, and EXTRA_CORS_ORIGINS.
//  - localhost, outside production.
//
// Enforced twice in main.ts, because CORS alone is not a CSRF defence: CORS
// only stops a page READING the answer, and a form post never asks first.
//  - CORS grants credentials to allowed origins only. Everyone else still gets
//    a plain `*` for the public reads (cards, share data), which never carries
//    a session.
//  - Every unsafe method from a refused origin is answered 403 BEFORE the route
//    runs.

export interface OriginPolicy {
  /** Exact origins, scheme and all — the form a browser sends. */
  named: Set<string>;
  /** Bare domain; anything https at or under it is allowed. "" for none. */
  cookieDomain: string;
  allowLocalhost: boolean;
}

export function originPolicyFromEnv(env: Record<string, string | undefined> = process.env): OriginPolicy {
  const named = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw) return;
    try {
      named.add(new URL(raw).origin);
    } catch {
      /* not a URL — ignored rather than allowing something unintended */
    }
  };
  const web = (env.WEB_DOMAIN ?? "").trim();
  if (web) add(`https://${web}`);
  add(env.FIVESTACK_PANEL_URL);
  for (const o of (env.EXTRA_CORS_ORIGINS ?? "").split(",")) add(o.trim());
  return {
    named,
    cookieDomain: (env.AUTH_COOKIE_DOMAIN || (web ? `.${web}` : "")).replace(/^\./, "").toLowerCase(),
    allowLocalhost: env.NODE_ENV !== "production",
  };
}

/**
 * The host this request was addressed to, without the port. Read the same way
 * as share.ts's requestOrigin. Trusting X-Forwarded-Host is safe HERE: a page
 * can only set it on a request that needs a preflight, and the preflight is
 * judged on the real host.
 */
export function requestHost(headers: Record<string, unknown>): string {
  const raw = String(headers["x-forwarded-host"] ?? headers.host ?? "").split(",")[0].trim().toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(raw)) return "";
  return raw.replace(/:\d+$/, "");
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** May a page at `origin` act with the caller's session on a request to `host`? */
export function isAllowedOrigin(policy: OriginPolicy, origin: string | undefined, host: string): boolean {
  // No Origin at all: curl, the game server, a server-side fetch. None of them
  // can be riding someone else's cookie. (The guard also checks Sec-Fetch-Site
  // for a browser that left Origin off.)
  if (origin === undefined) return true;
  if (policy.named.has(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin); // "null" (a sandboxed frame, file://) throws here
  } catch {
    return false;
  }
  const name = url.hostname.toLowerCase();
  if (policy.allowLocalhost && LOCAL_HOSTS.has(name)) return true;
  // The session cookie is Secure: a plaintext page never carried one, and
  // trusting one would hand a session to anyone who can answer for a name over
  // http.
  if (url.protocol !== "https:") return false;
  if (host && name === host) return true;
  // A PARENT of this host: the panel. Two labels at least, so a bare TLD never
  // counts — and on the dot, so `evil-5stack.gg` is not a parent of anything.
  // Not for a host reached by IP, where "parent" means nothing (4.15 / 10.42.4.15).
  if (host && name.includes(".") && !/^[\d.]+$/.test(host) && host.endsWith(`.${name}`)) return true;
  const domain = policy.cookieDomain;
  return !!domain && (name === domain || name.endsWith(`.${domain}`));
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The CSRF verdict for one request: null to let it through, or why not.
 * Only unsafe methods are judged — no GET here changes anyone's state.
 */
export function refuseCrossSite(
  policy: OriginPolicy,
  method: string,
  headers: Record<string, unknown>,
): string | null {
  if (SAFE_METHODS.has(method.toUpperCase())) return null;
  const origin = typeof headers.origin === "string" ? headers.origin : undefined;
  if (origin === undefined) {
    // Every current browser sends Origin on a cross-origin POST; this is for one
    // that does not, and costs nothing for clients that are not browsers.
    return headers["sec-fetch-site"] === "cross-site" ? "cross-site request without an Origin" : null;
  }
  return isAllowedOrigin(policy, origin, requestHost(headers)) ? null : `origin ${origin} is not allowed`;
}
