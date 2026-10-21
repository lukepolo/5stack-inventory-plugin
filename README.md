# 5stack Inventory

A CS2 inventory and loadout simulator that runs inside your 5stack panel.
Players craft and equip skins, knives, gloves, agents, stickers and charms, and
see them in game on your servers.

## Install

On the machine your 5stack panel runs on, from your `5stack-panel` folder:

```bash
./plugin.sh https://github.com/lukepolo/5stack-inventory-plugin
```

Press Enter at each question to keep the default, except one: if it asks which
node to run on, pick a machine that hosts your game servers. Item art and 3D
models come from the CS2 install there.

When it finishes:

1. **DNS:** point the host it printed (`inventory.<your panel's domain>` by
   default) at the same address as your panel. Behind a Cloudflare Tunnel, add
   it as a public hostname instead. If your panel issues its own certificates,
   wait for this one too; the installer prints the command to watch it.
2. **Register it:** in the panel, open **Settings → Application → Panel
   Plugins** and turn on the switch beside **Panel Plugins**. Then **Add Panel
   Plugin**, paste `https://<that host>`, press **Detect**, and save.

Inventory now shows in the panel's sidebar.

## Skins on your game servers

On the Inventory page, an administrator opens the **⚙ settings** button, then
the **Game Server** tab:

1. **Generate key**.
2. **Install and configure** (**Configure my servers** if the CS2 Inventory
   Simulator plugin is already installed). This installs the plugin on your
   servers and writes its settings for you.
3. **Open its page to turn them off**, and turn Valve's server guidelines off
   for the plugin there. Skins don't show in game until you do. Its page warns
   that this can get every game server token (GSLT) on your Steam account
   banned.

## Item art and 3D models

They are extracted from your own CS2 install the first time the plugin starts,
or as soon as that machine's CS2 install finishes. It takes a while; watch it
under **⚙ settings → 3D Models**.

The inventory has to run on a machine that hosts your game servers, because that
is where CS2 is installed.

## Updating

From your `5stack-panel` folder:

```bash
git pull && ./update.sh
./plugin.sh https://github.com/lukepolo/5stack-inventory-plugin
kubectl -n 5stack rollout restart deployment/inventory-backend deployment/inventory-frontend
```

Your answers from the first install are kept. The last line is what picks up the
new version.

## Troubleshooting

| You see | Fix |
| --- | --- |
| A CORS error containing *must not be the wildcard '\*'* | Update (above). The installer tells the plugin your panel's domain. |
| Nobody is signed in on the Inventory page | The plugin's host has to sit under your panel's domain. Re-run `./plugin.sh` with `--domain inventory.<your panel's domain>`, point DNS at it, then edit the plugin under **Panel Plugins** and press **Detect** again. |
| **3D Models** says *No CS2 install at /cs2-game* (or *CS2 install not readable*) | The inventory is on a machine without CS2. Move it to one of your game-server machines (below). |
| The installer says *inventory-backend isn't ready*, and `kubectl -n 5stack describe pod -l app=inventory-backend` mentions `/opt/5stack/serverfiles` | The machine it runs on has no CS2 folder at all. Move it to one of your game-server machines (below). |

To move the inventory to another machine, see where it is now with
`kubectl get nodes -L 5stack-inventory`, then:

```bash
kubectl label node <current machine> 5stack-inventory-
kubectl label node <game-server machine> 5stack-inventory=true
./plugin.sh https://github.com/lukepolo/5stack-inventory-plugin
kubectl -n 5stack rollout restart deployment/inventory-backend deployment/inventory-frontend
```

## Changing the plugin

How it works, the game-server API, local development and installing by hand are
in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## License

Licensed under the [GNU AGPL v3](LICENSE), with the additional terms in [NOTICE](NOTICE): keep the "Powered by 5Stack" credit, and do not present a modified version as the official 5Stack. Shader code and data taken from Counter-Strike 2 are Valve's and are not covered, see NOTICE. For other licensing, contact [@lukepolo](https://github.com/lukepolo). By contributing you agree to the terms in [CONTRIBUTING.md](CONTRIBUTING.md).
