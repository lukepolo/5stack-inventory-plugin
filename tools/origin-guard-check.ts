// Does the CSRF guard let the panel in and keep everyone else out?
//
// Run: node --experimental-strip-types tools/origin-guard-check.ts
//
// Why this exists
// ---------------
// The guard's two failure modes are both silent. Too loose, and it is the old
// `origin: true` again: any page a player opens can act as them, and nothing
// looks wrong. Too tight, and every craft and equip from the real panel is a
// 403 that the browser reports as an anonymous CORS error. Both depend only on
// strings — the Origin, the host, the env — so they can be pinned here.
import { isAllowedOrigin, originPolicyFromEnv, refuseCrossSite, requestHost } from "../backend/src/originGuard.ts";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL ${label}\n  got  ${g}\n  want ${w}`);
    failures++;
  } else {
    console.log(`ok   ${label}  ${g}`);
  }
}

const HOST = "inventory.5stack.gg";

// The flagship as deployed: no domain config at all.
const bare = originPolicyFromEnv({ NODE_ENV: "production" });
const allowed = (origin: string | undefined, host = HOST, policy = bare) => isAllowedOrigin(policy, origin, host);

check("panel (parent domain) is allowed", allowed("https://5stack.gg"), true);
check("this host is allowed", allowed("https://inventory.5stack.gg"), true);
check("no Origin (server, curl) is allowed", allowed(undefined), true);
check("unrelated site is refused", allowed("https://evil.com"), false);
check("look-alike suffix is refused", allowed("https://evil-5stack.gg"), false);
check("sibling subdomain needs config", allowed("https://other.5stack.gg"), false);
check("plaintext panel is refused", allowed("http://5stack.gg"), false);
check("opaque origin is refused", allowed("null"), false);
check("bare TLD is never a parent", allowed("https://gg"), false);
check("a child of this host is not a parent", allowed("https://x.inventory.5stack.gg"), false);
check("localhost refused in production", allowed("http://localhost:3000"), false);
check("IP host has no parents", allowed("https://4.15", "10.42.4.15"), false);

// The 5stack API's own variables widen it the same way they widen the API.
const web = originPolicyFromEnv({ NODE_ENV: "production", WEB_DOMAIN: "5stack.gg" });
check("WEB_DOMAIN: sibling inside the cookie scope", allowed("https://other.5stack.gg", HOST, web), true);
check("WEB_DOMAIN: still https only", allowed("http://other.5stack.gg", HOST, web), false);
const extra = originPolicyFromEnv({ NODE_ENV: "production", EXTRA_CORS_ORIGINS: "https://panel.example.net, https://x.trycloudflare.com" });
check("EXTRA_CORS_ORIGINS: named panel", allowed("https://panel.example.net", HOST, extra), true);
check("EXTRA_CORS_ORIGINS: second entry", allowed("https://x.trycloudflare.com", HOST, extra), true);
check("EXTRA_CORS_ORIGINS: exact origin only", allowed("https://panel.example.net:8443", HOST, extra), false);
const panelUrl = originPolicyFromEnv({ NODE_ENV: "production", FIVESTACK_PANEL_URL: "https://cs.example.org/" });
check("FIVESTACK_PANEL_URL counts", allowed("https://cs.example.org", "inventory.example.org", panelUrl), true);
const dev = originPolicyFromEnv({});
check("localhost allowed outside production", allowed("http://localhost:3000", HOST, dev), true);

check("host strips the port", requestHost({ host: "inventory.5stack.gg:443" }), "inventory.5stack.gg");
check("host prefers X-Forwarded-Host", requestHost({ host: "10.0.0.1:3000", "x-forwarded-host": "Inventory.5stack.gg" }), "inventory.5stack.gg");
check("host rejects junk", requestHost({ host: "evil.com/%0a" }), "");

const req = (method: string, headers: Record<string, string>) => refuseCrossSite(bare, method, { host: HOST, ...headers });
check("GET from anywhere passes", req("GET", { origin: "https://evil.com" }), null);
check("preflight passes (CORS answers it)", req("OPTIONS", { origin: "https://evil.com" }), null);
check("POST from the panel passes", req("POST", { origin: "https://5stack.gg" }), null);
check("POST from elsewhere is refused", typeof req("POST", { origin: "https://evil.com" }), "string");
check("DELETE from elsewhere is refused", typeof req("DELETE", { origin: "https://evil.com" }), "string");
check("POST with no Origin (game server) passes", req("POST", {}), null);
check("POST with no Origin but cross-site is refused", typeof req("POST", { "sec-fetch-site": "cross-site" }), "string");

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall origin guard checks pass");
