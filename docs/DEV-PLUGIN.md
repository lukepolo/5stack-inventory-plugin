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
| `docs/DEV-PLUGIN.md` | this file |

## Building the dev copy locally

The same build the action runs, for checking output before pushing:

```bash
PLUGIN_BASE=https://lcrew.github.io/5stack-inventory-plugin/ \
PLUGIN_SCOPE=inventory_dev \
VITE_INVENTORY_API=https://inventory.fulm.eu \
npm run build
```

## Taking a change to the installed plugin

The dev copy only ever replaces the frontend. To put your changes on the
installed plugin, or to change the backend, you need the full install from this
fork: images built to your own registry and `k8s/base/deployment.yaml` pointed
at them, then `./plugin.sh https://github.com/LCrew/5stack-inventory-plugin`.
See [DEVELOPMENT.md](DEVELOPMENT.md#installing-by-hand).
