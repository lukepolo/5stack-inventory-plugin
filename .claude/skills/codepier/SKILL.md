---
name: codepier
description: |
  Development against a CodePier hot-swapped Kubernetes pod. Use whenever the project has a
  codepier.yaml, or the user mentions codepier, a hot swap, "the swapped pod", "the container",
  or the codepier CLI (up, down, ssh, exec, proxy, tail).

  Read this BEFORE running any install, build, codegen, migration, or test command in such a
  project — the code runs in a Linux container in a cluster, not on the local machine, and running
  the command on the wrong side corrupts the tree. Also use when diagnosing "works locally but not
  in the pod" failures, native-module/platform errors right after an install, or when resolving a
  .local hostname or port to a service.
metadata:
  version: 2.0.35
---

# CodePier

CodePier hot-swaps a Kubernetes workload with a dev container. `codepier up` scales the real
workload to 0, starts a `<workload>-hot-swap` pod running the image from `codepier.yaml`, and
Mutagen keeps the local tree and the container's tree in sync.

**The consequence that matters: the editor is local, the runtime is Linux in a cluster, and the two
filesystems are continuously mirrored into each other.** Almost every mistake in a CodePier project
comes from forgetting one of those three facts.

## 1. Establish the session first

Read `./codepier.yaml` and work out:

| What         | Where                                                                |
| ------------ | -------------------------------------------------------------------- |
| namespace    | `namespaces` (string, or an array meaning "was chosen at `up` time") |
| workload     | `workload`, falling back to the legacy `deployment`                  |
| kind         | `kind`, default `Deployment`                                         |
| container    | `containers`, or `dev` when `supplemental: true`                     |
| working dir  | `workdir`                                                            |
| path mapping | `sync`, as `<local>:<container>`                                     |

Then confirm a swap is actually live:

```bash
codepier exec -- true
```

**If that fails, stop and tell the user to run `codepier up`.** Do not run `up` or `down` yourself.
`up` scales the real workload to zero, is interactive, and will disconnect a teammate who already
has a swap on that workload. Starting and stopping the session is the user's decision.

## 2. Two filesystems, one tree

`sync` maps local paths to container paths — with `.:/opt/myapp`, the local `src/index.ts` is
`/opt/myapp/src/index.ts` in the pod. Translate in both directions when reading a stack trace or
citing a file, and cite the **local** path to the user.

**Always edit files locally.** Mutagen propagates them within a second or so. Never edit through
`codepier exec` — a heredoc or `sed` inside the pod races the syncer and can lose the change.

## 3. Build-critical work runs in the container

Use `codepier exec` for anything whose _output_ lands in a synced path or that depends on the Linux
runtime:

```bash
codepier exec -- pnpm install
codepier exec -- pnpm run codegen
codepier exec -- pnpm run build
codepier exec -- pnpm test
codepier exec --cwd /opt/myapp/packages/db -- pnpm run migrate
```

`exec` is non-interactive: it resolves the pod from `codepier.yaml`, starts in `workdir` (override
with `--cwd`), streams stdout/stderr, and exits with the command's own exit code. Diagnostics go to
stderr, so stdout is safe to pipe.

Things that only read the source — lint, formatting, type-reading, `grep` — are fine locally.

**If you are unsure whether a command needs to run in the container, ask the user.** Getting this
wrong is expensive to undo.

## 4. The sync-back trap

Mutagen runs in `two-way-resolved` mode: files written **in the container flow back to the local
machine**, and vice versa. So an install run on the wrong side doesn't just fail — it overwrites
the other side's artifacts.

Symptoms: a native module built for the wrong platform, `Exec format error`, an architecture
mismatch, or a binary that runs in the pod but not locally (or the reverse) right after a dependency
change.

Platform-specific output — `node_modules`, `dist`, `target`, `.venv` — must be either listed in
`ignore:` or kept on a `cache:` volume so it never crosses the boundary. If a project has neither
and hits this, say so rather than papering over it with a reinstall; some repos add a dedicated
script that installs into the container and moves the result into place.

## 5. Proxy

`codepier proxy` serves the `proxy:` entries over HTTPS using locally-trusted mkcert certificates.
`.local` hostnames resolve via mDNS with no `/etc/hosts` edits. `--port N` avoids needing sudo for 443. `--exec "<cmd>"` runs a command once the proxy is ready, with `NODE_EXTRA_CA_CERTS` set so
child processes trust the certs:

```bash
codepier proxy --port 8443
codepier proxy --exec "pnpm run codegen && pnpm dev"
```

To resolve a URL, match the `hostname` entry, then check its `routes[]` for a matching
`pathPrefix` **before** falling back to the host's own `service`/`port` — first match wins, and a
prefix matches the exact path and any subpath (`/auth` matches `/auth/github`, not `/authxyz`). An
entry with no `service` points at a port on the local machine, not the cluster. `remoteHostname`
rewrites the `Host` header sent upstream.

## 6. Logs

`codepier tail` streams pod logs — but the hot-swap container's entrypoint is a sleep, so it has
none of its own. The application's output goes to whatever the user started in their own
`codepier ssh` shell. **Empty `tail` output does not mean the app is down**; ask the user what their
shell is showing.

`forward:` lists `local:remote` port forwards. Don't assume a port is reachable on localhost unless
it's there or covered by a `proxy` entry.

## 7. Never

- Run `codepier up` or `codepier down` — ask the user.
- `kubectl scale`, `kubectl delete`, or otherwise mutate the workload; the swap owns its lifecycle
  and a stray change strands the real workload at 0 replicas.
- Edit files inside the pod.
- Run installs or builds on the local machine "just to check" — that is the failure this whole
  setup is designed to avoid.

## Reference

`references/codepier-yaml.md` — every `codepier.yaml` field, its meaning, and worked examples.
