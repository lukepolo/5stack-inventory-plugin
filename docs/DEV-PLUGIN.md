# Dev copy on your own panel

How to run this fork as a **second, separate plugin** next to the installed
Inventory. Use it to try UI changes inside the real panel without touching the
installed copy. Nothing is installed on the cluster: GitHub Pages hosts the
built frontend, and the panel loads it the same way it loads any
[5stack plugin](https://docs.5stack.gg/plugins/).

| | Installed plugin | Dev copy |
| --- | --- | --- |
| Page | `/apps/inventory` | `/apps/inventory-dev` |
| Frontend served from | `https://inventory.<panel domain>` | `https://lcrew.github.io/5stack-inventory-plugin` |
| Backend, database, item art | the installed backend | **the same installed backend** |
| Who sees it | `verified_user` and up | `administrator` only |

The dev copy talks to the live backend, so **it reads and writes real
inventories and loadouts**. That is what lets UI work be tested against real
data without a second deployment. It also means you should not use it for
experiments you would not run on the installed plugin.

## One-time setup

1. **GitHub Pages:** in the fork, open **Settings → Pages** and set **Source**
   to **GitHub Actions**. For this fork that is already done.
2. **Actions:** open the fork's **Actions** tab and enable workflows if GitHub
   asks. GitHub turns them off on new forks.
3. **Turn off the upstream image build:** in **Actions**, open **ci** and choose
   **Disable workflow**. It pushes Docker images to ghcr.io on every push to
   `main`, and the dev copy does not use them.
4. **Backend URL (optional):** the build talks to `https://inventory.fulm.eu`.
   For a different backend, set a repository variable under **Settings →
   Secrets and variables → Actions → Variables**: `INVENTORY_API` =
   `https://inventory.<your panel domain>`.
5. **First deploy:** push to `main`, or run **dev-plugin** from the Actions tab.
   When it is green, check that
   `https://lcrew.github.io/5stack-inventory-plugin/5stack-plugin.json` shows
   `"slug": "inventory-dev"`.

## Register it in the panel

Same steps as any plugin
([docs](https://docs.5stack.gg/plugins/deploying#register-it)):

1. Open **Settings → Application → Panel Plugins**. Make sure the switch beside
   **Panel Plugins** is on.
2. **Add Panel Plugin** and paste
   `https://lcrew.github.io/5stack-inventory-plugin`.
3. Press **Detect**. The form fills in **Inventory (dev)**, slug
   `inventory-dev`, scope `inventory_dev`, required role `administrator`.
4. Toggle **Enabled** and save.

**Inventory (dev)** now shows in the sidebar for administrators. It also adds
an **Inventory (dev)** tab on player profiles. Clear the **Player Profile Tab**
label in the form if you don't want that.

## Making a change

```bash
# edit src/..., then:
npm run typecheck && npm run check:sfc && npm run check:i18n
git commit -am "ui: ..." && git push
```

The **dev-plugin** action builds and deploys in about two minutes. Then
**hard-reload** `/apps/inventory-dev`. The panel cache-busts `remoteEntry.js`
only on page load, so an open tab keeps running the old build. The gear dialog
shows the build time it is running, and a banner appears when a newer one has
been deployed.

Switching between `/apps/inventory` and `/apps/inventory-dev` in the same tab?
Hard-reload in between. Both copies inject their CSS under the same
`[data-cs2-inventory]` scope, so whichever loaded last wins until the page
reloads.

## Keeping up with upstream

```bash
git fetch upstream
git merge upstream/main
git push
```

The changes this fork makes for the dev copy are all opt-in through build
environment variables, so a normal build is the upstream build:

| File | Change |
| --- | --- |
| `vite.config.ts` | `base` from `PLUGIN_BASE`, Federation `name` from `PLUGIN_SCOPE` |
| `src/composables/useBuildCheck.ts` | reads `build-info.json` from an absolute `base` when there is one |
| `.github/workflows/dev-plugin.yml` | the Pages build and the dev manifest |
| `.github/workflows/dev-backend.yml`, `k8s/dev/`, `scripts/dev-backend.sh` | the dev backend (below) |
| `docs/DEV-PLUGIN.md` | this file |

## Building the dev copy locally

The same build the action runs, for checking output before pushing:

```bash
PLUGIN_BASE=https://lcrew.github.io/5stack-inventory-plugin/ \
PLUGIN_SCOPE=inventory_dev \
VITE_INVENTORY_API=https://inventory.fulm.eu \
npm run build
```

## Dev backend (optional)

Backend changes (an editable StatTrak count, the C4's 3D model, cards lit by
the CS2 rig) need this fork's backend running somewhere. The dev backend runs
it **beside** the installed one, in the same cluster, without replacing
anything:

| | Installed plugin | Dev backend |
| --- | --- | --- |
| Deployment | `inventory-backend` | `inventory-dev-backend` |
| Image | upstream `:latest` | `ghcr.io/lcrew/5stack-inventory-plugin-backend:dev`, built by **dev-backend** |
| Host | `inventory.<panel domain>` | `inventory-dev.<panel domain>` (`/` still served by the installed frontend) |
| Database | | **shared** — same inventories, same loadouts |
| Models mount, CS2 install | | **shared** — same node |
| Card store | `/cs2-models/renders` | `/cs2-models/renders-dev`, baked under the CS2 rig |
| Model extraction | automatic | by hand only (⚙ settings → 3D Models) |

Sharing the database is what makes it useful: what you equip through the dev
copy is what the installed backend's feed sends your game servers, so `!ws` in
game shows it with no server reconfigured. It is safe while the fork's backend
changes add nothing to the database schema; one that does needs its own
database instead.

### Install

1. **Image:** the **dev-backend** workflow builds it on every push that touches
   the backend (or run it from the Actions tab). The first time, make the
   package public so the cluster can pull it: GitHub profile → **Packages** →
   **5stack-inventory-plugin-backend** → **Package settings** → **Change
   visibility** → **Public**.
2. **Run it**, on the machine the panel runs on (where `kubectl` works):

   ```bash
   git clone https://github.com/LCrew/5stack-inventory-plugin.git
   cd 5stack-inventory-plugin
   ./scripts/dev-backend.sh
   ```

   It reads everything from the installed plugin (database connection, panel
   domains, ingress class, TLS) and asks nothing. `DOMAIN=...` overrides the
   host.
3. **DNS:** point `inventory-dev.<panel domain>` wherever
   `inventory.<panel domain>` points (behind a Cloudflare Tunnel, add it as a
   public hostname for the same service).
4. **Point the dev copy at it:** repository variable `INVENTORY_API` =
   `https://inventory-dev.<panel domain>`, then re-run **dev-plugin**. Setting
   it back to the installed host returns the dev copy to the installed backend.

Updating after a push: `./scripts/dev-backend.sh update` (once the
**dev-backend** run is green). Removing: `./scripts/dev-backend.sh remove`.

### The C4's 3D model

The extractor now names the C4's model, but the installed backend extracted the
mount without it. Open the dev copy's **⚙ settings → 3D Models** and press
**Run extraction** once: it re-runs the whole pipeline from your CS2 install —
the same job the installed backend runs after a CS2 update, and as long — and
adds `c4.glb` with its sticker and charm positions. The files land on the shared
mount, where the installed plugin simply ignores the C4.

### After an extraction

An extraction rewrites the shared mount; the cards baked before it stay as they
were. Clear them in the dev copy (**⚙ → Asset Cache → Clear renders**) so they
re-bake from the new assets, then hard-reload. `models/extract-version.json` on
the dev backend shows which pipeline version ran, on which CS2 build, and how
long each step took.

To track down something that looks wrong in the dev copy, see
[DEBUGGING.md](DEBUGGING.md).

## Taking a change to the installed plugin

The dev copy never replaces anything the installed plugin runs. To put your
changes on the installed plugin itself, either get them merged upstream, or
install from this fork: images built to your own registry and
`k8s/base/deployment.yaml` pointed at them, then
`./plugin.sh https://github.com/LCrew/5stack-inventory-plugin`. See
[DEVELOPMENT.md](DEVELOPMENT.md#installing-by-hand).
