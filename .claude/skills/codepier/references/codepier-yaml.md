# `codepier.yaml` reference

Lives in the project root. Read by every CodePier command to work out what to swap, what to sync,
and how to route traffic.

## Target selection

### `namespaces`

Kubernetes namespace(s). A single string is used directly; an array means the user was prompted at
`codepier up` time. Non-interactive commands need `--namespace` when it's an array.

```yaml
namespaces: staging # used as-is
namespaces: [staging, development] # prompted
```

### `workload` (legacy alias: `deployment`)

Workload name(s) to hot-swap. Same string-or-array behaviour as `namespaces`. `workload` wins when
both are present.

```yaml
workload: api-server
workload: [api-server, worker]
```

### `kind`

`Deployment` (default), `StatefulSet`, or `DaemonSet`.

DaemonSets have no replica count, so a DaemonSet swap is materialised as a single-replica Deployment
pinned to one node via a `kubernetes.io/hostname` selector, and the node is tainted so nothing else
schedules onto it for the session. The node is chosen interactively or with `--node`.

### `containers`

Restricts which containers may be targeted. Omit to allow any container in the pod.

```yaml
containers:
  - api
```

### `supplemental`

When `true`, the dev container is **added alongside** the existing containers instead of replacing
one — the original process keeps running. The dev container is always named `dev`.

```yaml
supplemental: true
```

## The dev container

### `image`

Image for the swapped container. A single string, or a map keyed by architecture.

```yaml
image: node:22

image:
  arm64: ghcr.io/myorg/dev:arm64
  amd64: ghcr.io/myorg/dev:amd64
```

### `workdir`

Working directory inside the container. Where `codepier ssh` and `codepier exec` start.

```yaml
workdir: /opt/myapp
```

### `env`

Environment variables for the dev container. `from_env: true` forwards the variable from the user's
local shell instead of using a literal value.

```yaml
env:
  - name: NODE_ENV
    value: development
  - name: AWS_ACCESS_KEY_ID
    from_env: true
```

## File sync

### `sync`

`<local>:<container>` pairs kept in sync by Mutagen in **`two-way-resolved` mode** — changes flow
in both directions. `.` means the project root.

```yaml
sync:
  - .:/opt/myapp
  - ./config:/etc/myapp
```

### `ignore`

Gitignore-style patterns excluded from sync. **This is the main defence against platform-specific
build output crossing between the local machine and the Linux container.**

```yaml
ignore:
  - node_modules
  - .git
  - dist
  - "*.log"
```

### `cache`

Persistent volumes that survive pod restarts, as `name:path` or a plain path. Ideal for package
manager caches and for keeping heavy, platform-specific directories off the synced tree.

```yaml
cache:
  - npm:~/.npm
  - pip:~/.cache/pip
  - /app/node_modules
```

## Networking

### `forward`

`local:remote` port forwards from the machine into the pod.

```yaml
forward:
  - "3000:3000"
  - "9229:9229" # debugger
```

### `proxy`

HTTPS reverse-proxy entries served by `codepier proxy`. Each maps a local hostname to an upstream.

- `hostname` — the name the proxy listens on. `.local` names are published over mDNS.
- `service` — a Kubernetes service to port-forward to. **Omit it to target a port on the local
  machine instead** (e.g. a dev server the user is running).
- `port` — upstream port.
- `remoteHostname` — overrides the `Host` header sent upstream, for when the listen name differs
  from what the cluster ingress expects.
- `routes[]` — path-prefix overrides, checked before the host's own upstream. Each has
  `pathPrefix`, `port`, and optionally `service` / `remoteHostname`. A prefix matches the exact
  path and any subpath (`/auth` matches `/auth/github`, not `/authxyz`). **First match wins.**

```yaml
proxy:
  # Local dev server, with /auth handled by the cluster API — mirrors the prod ingress
  - hostname: app.codepier.local
    port: 5173
    routes:
      - pathPrefix: /auth
        service: api-server
        port: 4000

  - hostname: api.codepier.local
    service: api-server
    port: 3000

  # Listen locally under one name, forward as another
  - hostname: dev.api.codepier.local
    remoteHostname: api.codepier.local
    service: api-server
    port: 3000
```

### `proxyPort`

Port the HTTPS proxy listens on. Defaults to `443`, which needs sudo — a high port avoids that.
Overridable per-run with `codepier proxy --port`.

```yaml
proxyPort: 8443
```

## Commands

| Command                  | Purpose                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `codepier up`            | Start the hot swap. Interactive. **User runs this, not the agent.**  |
| `codepier down`          | Restore the original workload. **User runs this.**                   |
| `codepier exec -- <cmd>` | Run one command in the swapped pod. Non-interactive, real exit code. |
| `codepier ssh`           | Interactive shell in the pod. Not usable by an agent.                |
| `codepier tail`          | Stream pod logs (a swapped container has none of its own).           |
| `codepier proxy`         | Start the HTTPS reverse proxy.                                       |
| `codepier sync-status`   | Mutagen sync state — useful when a file edit doesn't seem to land.   |
| `codepier clean`         | Remove orphaned sync directories from cluster nodes.                 |

Global flags accepted by any command: `--config <kubeconfig>`, `--context`, `--namespace`,
`--deployment`, `--container`, `--pod`, `--node`.

## Worked example

```yaml
namespaces: [codepier]
workload: api
kind: Deployment

image: node:22
workdir: /opt/codepier/apps/api

sync:
  - .:/opt/codepier

ignore:
  - /apps/api/dist

cache:
  - npm:~/.npm

proxyPort: 6685
proxy:
  - hostname: api.codepier.local
    service: api
    port: 5585
  - hostname: codepier.local
    port: 3000 # local Next dev server
    routes:
      - pathPrefix: /auth # …except /auth, which the cluster API serves
        service: api
        port: 5585
```

With this config: the local repo root is `/opt/codepier` in the pod, `codepier exec` starts in
`/opt/codepier/apps/api`, and `https://codepier.local:6685/auth/github` reaches the `api` service on
5585 while every other path goes to the local dev server on 3000.
