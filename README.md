# 5stack Inventory Plugin

A CS2 inventory simulator that renders **natively inside the 5stack panel** as a
[plugin](https://github.com/5stackgg). It is **not** part of the 5stack
brand or codebase — it's an independent micro-frontend, loaded at runtime via
Module Federation, that reuses 5stack's Steam login instead of its own auth.

This repo doubles as the **reference template** for building any 5stack Custom
Page.

## How it fits together

```
5stack panel (host)                        this plugin
─────────────────────                      ────────────────
pages/apps/[...slug].vue ─Module Federation─▶  remoteEntry.js  (Vue "./App")
  resolves the remote by slug,                  exposes InventoryApp
  passes :user + the route props
  renders it in the real sidebar/header
                                            backend (Fastify)
cookie ──▶ /plugins/authorize ──▶ identity   validates the session itself,
                                              owns its `inventory` schema
```

- **No iframe** — the plugin is a real Vue component in the host's Vue app.
- **Shared design system** via `@5stack/ui` (Federation shared singleton), so it
  looks native and tracks the host's live branding.
- **Identity** comes from handing the inbound 5stack session cookie back to the
  panel's `/plugins/authorize`, never a cookie parse or Steam OpenID.

## Layout

| Path | What |
| --- | --- |
| `src/App.vue` | the loadout UI (exposed `./App` remote; receives the host props) |
| `src/pluginRouter.ts` | the routing contract — host props in, `go()`/`href()` out |
| `src/AdminConsole.vue` | the `/admin` route (server key, asset cache, extraction) |
| `vite.config.ts` | Federation `exposes` + shared singletons |
| `shared-globals.ts` | resolves `vue` to the panel's instance (replaces Federation `shared`) |
| `backend/src/catalog.ts` | CS2 item catalog via `@ianlucas/cs2-lib` |
| `backend/` | Fastify API + `inventory` Postgres schema |
| `k8s/` | kustomize package to drop into `5stack-panel/custom/inventory` |
| `codepier.yaml` | live-sync the backend into its pod for dev |

## Plugin routes (the routing contract)

A plugin owns **every URL under its slug**. The panel matches
`/apps/<slug>/:path*`, resolves the remote from the slug, and passes the rest
down as props — so a plugin gets real, linkable, back-button-able routes without
bundling `vue-router` (a second router instance inside a federated remote fights
the host's for the URL).

| Prop | What the host passes |
| --- | --- |
| `user` | the authenticated 5stack user (or `null`) |
| `base` | where the plugin is mounted, e.g. `/apps/inventory` |
| `path` | the path *below* the slug — `/` or `/admin` |
| `query` | the current query object |
| `navigate` | `(to, { replace?, query? }) => void`, `to` is plugin-relative |

`src/pluginRouter.ts` wraps those into a tiny router and — when the props are
absent (standalone `npm run dev`) — falls back to the History API, so the same
call sites work in both modes:

```ts
const router = usePluginRouter(props);   // props = { base, path, query, navigate }

router.path.value          // "/admin"
router.query.value.player  // "76561198…"
router.go("/admin");       // → host router.push("/apps/inventory/admin")
router.href("/", { player: id });        // absolute, base-aware share link
```

This plugin maps `/` → loadout, `/focus`, `/items` (owned items), and `/admin` with its own
sub-routes (`/admin/assets`, `/admin/models`) — the settings side tabs are routes,
the way the panel's own settings nav works. Screens are
`computed` off `router.path`, never assigned — the URL is the only source of
truth, so tabs, deep links and the back button can't disagree.

> Host side: `web/pages/apps/[...slug].vue` — one catch-all page that splits the
> segments itself (first = plugin slug, rest = plugin path). It delegates the
> actual federation load to `web/components/plugins/PluginRemote.vue`, which the
> player-profile tab (below) reuses. Two gotchas worth keeping: a nested optional
> catch-all (`[slug]/[[...path]].vue`) is mis-parsed by Nuxt into
> `/apps/:slug()/:path(.*)*]` and matches nothing; and the loader must watch the
> **slug** only — watching `route.params` remounts the remote on every route the
> plugin navigates to itself.

## The player-profile tab

A plugin can also mount as a tab on the panel's player pages. Set
`profileTabLabel` in `5stack-plugin.json` (admins can override it per-site in
Settings → Application → Plugins); the panel then renders a tab with that label
on `/players/:steamid`, beside Combat, and mounts the remote inside it.

In that position the host passes two extra query keys:

| Query | Meaning |
| --- | --- |
| `player` | the steam64 of the profile being viewed — **not** the logged-in user |
| `embed` | `"1"` — you are inside someone else's page, not at `/apps/<slug>` |

Both matter, and for different reasons:

- **`player`** is the same flag the shareable `?player=` link already uses, so
  viewer mode needed no new code — `src/App.vue` loads that player's loadout
  read-only and blanks `inventory`. Nothing writable is reachable while it's set.
- **`embed`** is about framing, not permissions. It is *not* the same as
  `router.embedded` (which only means "mounted in the panel at all", true for
  both positions). Embedded, the host page already supplies the chrome and owns
  the page scroll, so we drop the `100dvh` height, the share menu, and the
  Loadout/Inventory view pill — a lone "Loadout" button pointing at the screen
  you are already on is just noise.

The tab is read-only **including on your own profile**. At `/apps/inventory`,
`?player=<me>` deliberately drops you into your real editable inventory; in a
tab it must not, because the tab is a showcase and the bottom picker sheet
(owned / craft / replace), drag-to-equip and the slot menus all belong on the
full page. `load()` skips the usual "that's me, exit viewer mode" shortcut when
`embed=1`, which is what makes every existing `!viewerId` guard apply here too —
one condition instead of an embed check on each of them. On your own profile the
banner links out to the full editor.

Only the **equipped loadout** is shown, never owned items: `GET /api/inventory`
is hard-scoped to the caller, and the only public per-player endpoints are
`/api/loadout/:steamId` and `/api/equipped/v5/:steamId`. Showing someone else's
full collection would need a new endpoint *and* a decision about whether an
owned-item list should be public at all.

The navigation contract is unchanged, but the host wires it differently:
`navigate` writes **local state** instead of doing a `router.push`. That's the
whole trick — a push would send the viewer to `/apps/<slug>` the moment they
clicked anything inside the tab. Only `?tab=<slug>` ever reaches the host URL, so
plugin sub-navigation stays inside the tab and the profile page never unmounts.

> Host side: `web/pages/players/[id].vue` renders one tab per plugin in
> `profileTabPlugins` (filtered from `visiblePlugins`, so the plugins master
> switch, `enabled` and `required_role` all still gate it). The remote is
> `v-if`-gated on the active tab so a second app isn't fetched over the network
> until someone asks for it.

This replaced `src/profileLink.ts`, which used to float a "View CS2 Loadout" chip
onto player pages by monkey-patching `history.pushState`. That file is gone —
if you're looking for it in git history, this section is what it became.

## How the inventory works

- **Item/skin data** comes from [`@ianlucas/cs2-lib`](https://github.com/ianlucas/cs2-lib)
  (the same catalog the reference simulator uses). ~27k items — weapons, skins,
  knives, gloves, agents — with names, rarities, and images on
  `cdn.cstrike.app`, so we store **no assets**.
- **Loadout model**: one row per `(steam_id, team, slot)` in `inventory.loadout`,
  where `slot` is a weapon model (`ak47`) or a special slot (`knife`, `gloves`,
  `agent`) and `item_id` is a cs2-lib item id.
- **API**:
  - `GET /api/catalog` → base weapons (grouped by category client-side) + agents
  - `GET /api/catalog/skins?slot=<model|knife|gloves|agent>` → skins for a slot
  - `GET /api/loadout` → the user's equipped slots (enriched with item name/image)
  - `POST /api/loadout` `{team, slot, item_id}` → equip
  - `DELETE /api/loadout?team=&slot=` → unequip
- The UI has a CT/T toggle, special-equipment slots, weapon sections by category,
  and a skin picker. Knife/gloves apply to both teams; agents are per-team.

## Game-server API

Game servers run one of ianlucas' inventory-simulator plugins and talk to us
over three endpoints. Pick the build that matches the server's mod framework —
they speak the same protocol and the same convars, so the rest of this section
applies to either:

| Server framework   | Plugin                                                     |
| ------------------ | ---------------------------------------------------------- |
| Metamod / SourceMod (ss2) | [`ianlucas/cs2-ss2-inventory-simulator`][invsim]    |
| CounterStrikeSharp | [`ianlucas/cs2-css-inventory-simulator`][invsim-css]        |

Install: grab the latest release zip from that repo, unpack it into the
server's plugin directory (`addons/` — `sourcemod/`+`metamod/` for the ss2
build, `counterstrikesharp/plugins/` for the CSS build), and restart. Config
comes from the convars below, not from a plugin config file. 5stack's own
server images already ship the plugin; you only need this for servers you
build yourself.

Settings → generate the server API key writes this block to the top of the
panel's match config rows automatically, so servers pick it up with no manual
editing:

```
invsim_url "https://inventory.5stack.gg"
invsim_apikey "inv_…"
invsim_ws_enabled 1
invsim_ws_immediately 1
invsim_require_inventory 1
invsim_spraychanger_enabled 1
```

The Lan cfg row is intentionally left untouched by the sync — edit it by hand if
you want the block there.

| Method | Path                             | Auth               |
| ------ | -------------------------------- | ------------------ |
| GET    | `/api/equipped/v5/<steamid>.json` | **none**           |
| POST   | `/api/increment-item-stattrak`   | `apiKey` in body   |
| POST   | `/api/sign-in`                   | `apiKey` in body   |

Three things about this protocol are counter-intuitive and have each cost a
debugging session:

- **`invsim_ws_*` is not WebSockets.** `ws` means *weapon skin* — the `!ws` chat
  command that re-fetches a player's inventory over plain HTTP. There is no
  WebSocket anywhere in the plugin.
- **`invsim_require_inventory` is load-bearing, not optional.** Skins are baked
  into the weapon by a native `GiveNamedItem` detour at the moment the engine
  creates it — there is no spawn or team hook, and nothing re-evaluates a weapon
  that already exists. The inventory fetch is async HTTP fired at connect, and
  5stack auto-assigns a team and force-respawns ~100ms later, which beats the
  round-trip: the weapons get built vanilla and the player only sees their skins
  after their first death. This convar defers activation until the fetch lands.
  The trade-off is that a slow or unreachable backend now hangs players at
  connect instead of spawning them skinless.
- **`invsim_apikey` is never an HTTP header**, and the equipped `GET` sends no
  credential at all — it is a bare `GetAsync`. That endpoint must stay publicly
  readable by SteamID64. Putting the ingress' 5stack forward-auth in front of
  `/api` returns a `401` nginx HTML page to every game server, which reads like
  a bad API key but never reaches this process. See the warning in
  [the plugin backend docs][authdocs].

`/api/sign-in` and its browser-facing `/api/sign-in/callback` page are **not
implemented yet** — only relevant if a server enables `invsim_wslogin`
(defaults off).

[invsim]: https://github.com/ianlucas/cs2-ss2-inventory-simulator
[invsim-css]: https://github.com/ianlucas/cs2-css-inventory-simulator
[authdocs]: https://docs.5stack.gg/plugins/backend#optional-forward-auth-at-the-ingress

## Development (in-cluster, via CodePier)

Dev runs **inside the cluster** behind the real ingress, so there are no env
vars, no CORS to configure, and session-cookie identity + same-origin `/api`
just work. `codepier.yaml` lists both workloads, so `codepier up` lets you pick which
one to hot-swap.

```bash
# Frontend (build --watch + serve on :80)
codepier up --deployment inventory-frontend
codepier ssh   # then:  yarn dev:ui

# Backend (node --watch hot reload)
codepier up --deployment inventory-backend
codepier ssh   # then:  yarn dev:api
```

Edit locally; CodePier syncs and the `--watch` rebuild/restart happens in the
pod. The frontend is a Module Federation **remote**, so it must be *built* to
produce `remoteEntry.js` (a plain `vite` dev server can't serve one) — `dev:ui`
does the build-watch + serve in one command.

> Pin `vue`, `reka-ui`, `pinia`, `@5stack/ui` to the **same versions** the panel
> (`web`) uses, or Federation loads a second copy and reactivity breaks.

## Deploying to an existing 5stack site

1. **Build & push** both images:
   ```bash
   docker build -f Dockerfile.frontend -t ghcr.io/lukepolo/5stack-inventory-plugin-frontend:latest .
   docker build -f Dockerfile.backend  -t ghcr.io/lukepolo/5stack-inventory-plugin-backend:latest .
   docker push ghcr.io/lukepolo/5stack-inventory-plugin-frontend:latest
   docker push ghcr.io/lukepolo/5stack-inventory-plugin-backend:latest
   ```
2. **Drop `k8s/` into the panel** at `5stack-panel/custom/inventory/`.
3. **Configure**:
   - `inventory.env` → `INVENTORY_DOMAIN` (e.g. `inventory.yoursite.gg`) and
     `CORS_ALLOW_ORIGIN` (your panel origin, e.g. `https://yoursite.gg`).
   - `inventory-secrets.env` (copy from `inventory-secrets.env.example`) →
     `DATABASE_URL`. The plugin creates and owns an **`inventory` schema** (not
     a separate database) and schema-qualifies every query, so this is normally
     just a copy of the panel's own connection string:
     ```bash
     kubectl -n 5stack get secret -o name | grep timescaledb-secrets
     kubectl -n 5stack get secret <that-name> \
       -o jsonpath='{.data.POSTGRES_CONNECTION_STRING}' | base64 -d
     ```
     It's copied rather than referenced on purpose. The panel generates
     `timescaledb-secrets` with kustomize's `secretGenerator`, so its real name
     carries a content hash (`timescaledb-secrets-dfbc69dbh5`), and `custom.sh`
     builds this package standalone — with no view of that generator, a
     reference to the bare name wouldn't be rewritten and would resolve to
     nothing. Note this means the copy doesn't follow a panel password
     rotation; re-copy it if you rotate.
4. **Apply the schema** — `npm run migrate` in `backend/` (or run
   `backend/src/schema.sql`). It only does `CREATE SCHEMA inventory` + its
   tables; no database creation needed. The connecting role must be allowed to
   create a schema.
5. **3D models (optional)** — the frontend deployment expects a hostPath mount
   at **`/opt/5stack/models/cs2-model-extract`** on the node (mounted read-only
   at `/cs2-models`; `/models/*` is served from its `models/` subfolder).
   Populate it with `scripts/extract-models.sh` run against a CS2 install —
   or just hit "extract models" in the plugin's admin settings, which runs the
   same script in the backend pod against the CS2 dedicated-server install
   mounted at `/cs2-game` (hostPath `/opt/5stack/serverfiles`). The
   mount is `DirectoryOrCreate`, so pods run fine without it — the UI detects
   missing models via 404s and simply never offers 3D rendering. Refreshing
   models is a file copy on the node; no rebuild or redeploy.
6. **Deploy**: from the panel repo, `./custom.sh inventory`.
7. **Register the plugin** in the panel: Settings → Application → Plugins → Add,
   with:
   - **Slug**: `inventory`
   - **Remote Entry URL**: `https://inventory.yoursite.gg/assets/remoteEntry.js`
   - **Remote Scope**: `inventory`
   - **Exposed Module**: `./App`
   - **Required Role**: (optional — leave blank for public)
   - toggle **Enabled**, and enable the **Plugins** master switch.

The page now appears in the panel nav at `/apps/inventory`, rendered natively.

## The identity contract (for building your own plugin)

Host your backend on a subdomain of the panel, so the browser attaches the
5stack session cookie. Forward that cookie to
`http://api.5stack.svc.cluster.local:5585/plugins/authorize` and a `200` returns
`{ steam_id, role, name }` for the calling user; anything else is anonymous (see
`backend/src/identity.ts`, which also caches the lookup for a few seconds).
Expose your Vue root as a Federation module and register it as a plugin — that's
the whole framework.
