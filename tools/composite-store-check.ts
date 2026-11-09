// Only an administrator writes what every player is then served.
//
// Run: node --experimental-strip-types tools/composite-store-check.ts
//
// Craft takes any in-range wear and seed, so a player can own an item matching
// any skin's tuple, and the composite store and the weapon outlines are shared
// and first-write-wins. This drives the real route handlers in
// backend/src/sharedStores.ts: every write route they register has to refuse a
// player who isn't an administrator, so a second ungated one fails here.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { compositeDirIn, compositeStem } from "../backend/src/compositeStore.ts";
import { registerSharedStores } from "../backend/src/sharedStores.ts";

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

const Fastify = createRequire(new URL("../backend/package.json", import.meta.url))("fastify");
const root = mkdtempSync(path.join(tmpdir(), "composites-check-"));
const SALT = "0123456789abcdef0123456789abcdef";
const GEN = "abcdef0123456789-v42";
const MODEL = "weapon_ak47";
const PNG = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), Buffer.alloc(64, 7)]);
const QUERY = `kind=albedo&cap=2048&wear=0.1234&seed=7&model=${MODEL}&material=paints/case.vcompmat.json&legacy=0`;
const FILE = `${compositeStem({ model: MODEL, legacy: false, material: "paints/case.vcompmat.json", wear: 0.1234, seed: 7, cap: 2048 })}.albedo.png`;

const outlines: string[] = [];
const app = Fastify();
app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_r: unknown, body: Buffer, done: (e: null, b: Buffer) => void) =>
  done(null, body),
);
const writes: string[] = [];
app.addHook("onRoute", (route: { method: string | string[]; url: string }) => {
  for (const method of [route.method].flat()) {
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      writes.push(`${method} ${route.url}`);
    }
  }
});
registerSharedStores(app, {
  identity: async (request) => {
    const role = request.headers["x-role"];
    return typeof role === "string" ? { steamId: "76561198000000001", role, name: "" } : null;
  },
  compositeDir: async (gen) => compositeDirIn(root, gen, SALT),
  ownsComposite: async () => true,
  losslessWebp: async () => null,
  composited: () => {},
  isWeapon: () => true,
  weaponOutline: (body) => body,
  saveWeaponOutline: async (model) => {
    outlines.push(model);
  },
});
await app.ready();

const urlOf = (route: string) =>
  route.replace(":gen", GEN).replace(":file", FILE).replace(":model", MODEL) + (route.includes(":gen") ? `?${QUERY}` : "");
const send = (method: string, url: string, role?: string) =>
  app.inject({
    method,
    url,
    headers: { ...(role ? { "x-role": role } : {}), "content-type": url.includes("/composite/") ? "application/octet-stream" : "application/json" },
    payload: url.includes("/composite/") ? PNG : JSON.stringify({ model: MODEL, v: 2, points: [] }),
  });

check("the shared writes", writes.sort(), ["POST /api/composite/:gen/:file", "PUT /api/catalog/weapon-outline/:model"]);
for (const write of writes) {
  const [method, route] = write.split(" ");
  check(`${write} without a sign-in`, (await send(method, urlOf(route))).statusCode, 401);
  for (const role of ["user", "verified_user", "streamer", "match_organizer", "tournament_organizer"]) {
    const res = await send(method, urlOf(route), role);
    check(`${write} as ${role}`, [res.statusCode, res.json().admin_only], [403, true]);
  }
}
check("no player's file or outline landed", outlines, []);

const planted = path.join(root, GEN);
mkdirSync(planted, { recursive: true });
writeFileSync(path.join(planted, FILE), PNG);
check("a file planted under the bare generation is never served", (await app.inject({ url: `/api/composites/${GEN}/${FILE}` })).statusCode, 404);

const stored = await send("POST", urlOf("/api/composite/:gen/:file"), "administrator");
check("an administrator's composite is stored", [stored.statusCode, stored.json().file], [200, FILE]);
check("under the salted generation", readFileSync(path.join(root, `${GEN}.s${SALT}`, FILE)).equals(PNG), true);
const served = await app.inject({ url: `/api/composites/${GEN}/${FILE}` });
check("and served from there", [served.statusCode, served.rawPayload.equals(PNG)], [200, true]);
check("an administrator's outline is stored", [(await send("PUT", urlOf("/api/catalog/weapon-outline/:model"), "administrator")).statusCode, outlines], [200, [MODEL]]);

check("a generation can't climb out of the root", compositeDirIn(root, "..", SALT), null);
check("or carry a path", compositeDirIn(root, "a/b", SALT), null);
check("and there is no directory without the salt", compositeDirIn(root, GEN, ""), null);

const repoFile = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const main = repoFile("backend/src/main.ts");
check("main.ts registers the shared stores", main.includes("registerSharedStores(app, {"), true);
check(
  "and writes neither store itself",
  /app\.(post|put|patch)\s*(<[^>]*>)?\(\s*"\/api\/(composite|catalog\/weapon-outline)\//.test(main),
  false,
);
const client = repoFile("src/compositeStore.ts");
check("a refused client stops uploading for the session", /refusal\?\.admin_only\) \{\n\s+refusedForSession = true;/.test(client), true);

await app.close();
if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall shared store checks pass");
