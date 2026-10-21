# Caching and compression

How the plugin's files are cached and compressed on their way to the browser,
how to check it, and how to put a Cloudflare
cache in front of it (optional). For the extraction that writes the files, see
`scripts/extract-models.sh`; for debugging in general, [DEBUGGING.md](DEBUGGING.md).

## What is served, and by whom

Two kinds of file reach the browser:

- **The bundle** (`/assets/*`, `index.html`, `remoteEntry.js`): built by Vite
  into the frontend image.
- **The mount** (`/models`, `/paints`, `/images`, `/music`, `/anims`,
  `/composites`, `/renders`): written by the extraction onto the node's
  `/cs2-models` folder. An AK-47 alone is a 3.3 MB GLB, ~65 MB of textures
  and a 38 MB composite-input bundle, so this is where loading time goes.

Three servers can answer a mount path, and they must agree:

| Server | Runs where | Code |
| --- | --- | --- |
| nginx | the frontend pod (production) | `nginx.conf` |
| the backend's `serveAssetDir` | behind nginx's `try_files … @backend` (when the frontend pod cannot see a file) | `backend/src/main.ts` + `backend/src/assetResponse.mjs` |
| `scripts/serve.mjs` | hot-swap frontend pods (codepier), which have no nginx | `scripts/serve.mjs` + `backend/src/assetResponse.mjs` |

`assetResponse.mjs` makes the two Node servers decide every answer the same
way nginx does, and `npm run check:assets` pins the cases.

## Caching

The one rule: **a URL that can never change meaning is cached for a year; any
other is revalidated.** The extraction rewrites most files in place under the
same names, so a file only becomes "never changes" once the client has put the
extraction version on its URL (`?v=…`, `withAssetVersion` in `src/api.ts`).
The version changes when a full extraction finishes; `extract-version.json` is
written last, so a versioned URL never names a half-written mount.

| Path | `Cache-Control` |
| --- | --- |
| `/assets/*` (content-hashed by Vite) | `public, max-age=31536000, immutable` |
| `/assets/remoteEntry.js`, `index.html`, `/build-info.json` | `no-store, no-cache, must-revalidate` |
| `/models`, `/paints`, `/music`, `/anims` with `?v=` | `public, max-age=31536000, immutable` |
| the same without `?v=` (or with an empty one) | `no-cache` (revalidate every time) |
| `/images` (cs2-lib hashes the picture itself), `/composites` (the folder carries the version) | `public, max-age=31536000, immutable` |
| `/renders`, `/tests` | `public, max-age=86400` (nginx) |
| a miss (404) from the backend | `no-store` |

Every 200 carries an `ETag` and `Last-Modified`, so revalidating a file that
has not changed is a `304` with no body.

**What the client stamps.** Every mount file the viewer loads goes through
`withAssetVersion` (or `assetUrl`, `paintTextureUrl`, `modelUrlFor`,
`viewmodelAssetUrl`, which call it): every GLB (weapons, knives, gloves, agents,
charms, pets, the C4, arms), the textures a GLB names (through the loader's URL
modifier), composite-input `meta.json` and its PNGs and EXR, paint materials
and textures, sticker art and masks, StatTrak art, charm physics, pet styles
and clips, first-person clips, sounds and effects, map panoramas, and music.
Two kinds of request go out without it, and both are correct, just
revalidated: anything asked for before the catalog has loaded, and an older
client. `src/viewmodelClip.ts` and `src/petMaterial.ts` add a schema number
too (`c=`, `s=`), for a change to a file's shape that no extraction marks.

## Compression

Measured on the mount, gzip -5 against the original:

| File | Original | gzip | |
| --- | ---: | ---: | --- |
| `models/ak47.glb` | 3,301,996 | 1,120,425 (1,114,782 at -9) | compressed |
| `models/knife_karambit.glb` | 1,060,224 | 371,459 | compressed |
| `anims/ak47.inspect.json` | 272,876 | 32,146 | compressed |
| `models/pet-styles.json` | 126,928 | 9,741 | compressed |
| `models/knife-attachments.json` | 32,404 | 3,805 | compressed |
| `venice_sunset_1k.hdr` (bundle) | 1,440,400 | 1,127,792 | compressed |
| `models/ak47.inputs.hd/position.exr` | 925,583 | 897,372 | left alone (EXR zips itself) |
| PNG, WebP, JPEG, MP3 | | ~100% | left alone |

So all three servers gzip JS, CSS, HTML, JSON, SVG, GLB/glTF, HDR and wasm of
1 KB or more, at level 5, and leave images, EXR and audio alone. Audio is left
alone for a second reason: music is streamed by byte range, and a range cannot
address a body compressed on the fly.

**Precompressed files.** When the extraction writes `<file>.gz` (gzip -9) next
to a file, a client whose `Accept-Encoding` takes gzip gets that file as is,
with `Content-Encoding: gzip`, the **original's** `Content-Type` and
`Vary: Accept-Encoding`. Everyone else gets the original. An extraction that
wrote no `.gz` files is compressed on the fly instead, so old mounts lose
nothing. Rules for whoever writes them:

- Rewrite or delete a `.gz` whenever its original changes. nginx
  (`gzip_static`) never compares the two; the Node servers skip a `.gz` older
  than its original, to the second.
- That includes copying a `.glb` or `.json` into `/models` by hand: delete the
  `.gz` beside it as well, or nginx keeps sending the old copy to every
  browser. (`/anims` is never precompressed, so copying clips there is safe.)
- Never write one for audio. nginx answers a range request out of the `.gz`'s
  bytes when the client also accepts gzip.

The bytes on the wire change; the decoded bytes never do (checked by hashing
the decoded body against the file on disk for every server).

## Checking it

The extraction version the client stamps:

```bash
curl -s https://inventory.example.com/api/catalog | grep -o '"assetVersion":"[^"]*"'
```

Then, for a model with and without the stamp:

```bash
V=37-2000930-1792529962   # the assetVersion from above
curl -sI -H 'Accept-Encoding: gzip' "https://inventory.example.com/models/ak47.glb?v=$V" |
  grep -i -e content-type -e content-encoding -e content-length -e cache-control -e etag -e vary
curl -sI -H 'Accept-Encoding: gzip' "https://inventory.example.com/models/ak47.glb" | grep -i cache-control
```

Expect `content-type: model/gltf-binary`, `content-encoding: gzip`,
`cache-control: public, max-age=31536000, immutable` on the first and
`no-cache` on the second. Send the `etag` back as `If-None-Match` and the
answer is a `304`. Before these changes the same request returned
`content-type: application/octet-stream`, no encoding and all 3,301,996 bytes.


## Cloudflare (optional)

Nothing here needs a CDN, and nothing the servers send is Cloudflare-specific.
If the plugin's host is behind Cloudflare (a proxied DNS record or a Cloudflare
Tunnel), one Cache Rule lets the edge keep the big files close to players.

**Why it needs a rule.** Cloudflare only caches file extensions on its default
list. Measured: a versioned `.webp` or `.png` comes back
`cf-cache-status: HIT`, but `.glb` and `.json` come back `DYNAMIC`: every
player fetches every model from the origin. Cloudflare does not compress GLBs
either; with the changes above the origin does, and Cloudflare passes the
gzip through.

**The rule.** Cloudflare dashboard → your domain → **Caching → Cache Rules →
Create rule**:

1. **Rule name:** `Inventory assets`.
2. **If incoming requests match → Custom filter expression → Edit expression**
   (replace the host with the plugin's own):

   ```
   (http.host eq "inventory.example.com" and (
     starts_with(http.request.uri.path, "/models/") or
     starts_with(http.request.uri.path, "/paints/") or
     starts_with(http.request.uri.path, "/images/") or
     starts_with(http.request.uri.path, "/music/") or
     starts_with(http.request.uri.path, "/anims/") or
     starts_with(http.request.uri.path, "/composites/")))
   ```

   Never include `/api`: it carries sessions and must reach the backend every
   time.
3. **Cache eligibility:** Eligible for cache.
4. **Edge TTL:** *Use cache-control header if present, bypass cache if not*.
5. **Browser TTL:** *Respect origin TTL*.
6. **Cache key:** leave the defaults. The query string must stay in the key,
   because `?v=` is what tells one extraction's file from the next; do not turn
   on *Ignore query string*.
7. **Deploy.**

**Why it is safe.** The rule adds nothing the origin does not already promise:

- A versioned URL is `immutable` at the origin, so the edge keeps exactly what
  browsers already keep. A new extraction changes the version, so the URLs
  change and the edge fetches the new files; nothing needs purging.
- An unversioned URL is `no-cache`, so the edge revalidates it every time,
  which the `ETag` makes cheap.
- A miss is `no-store`, so a file asked for a moment before it existed is never
  kept as missing.
- Compressed and plain copies are kept apart by Cloudflare itself, and byte
  ranges for music are served out of the cached file.

**When to purge** (**Caching → Configuration → Purge Everything**, which only
costs a refetch): after a scoped extraction run (`ONLY_STEPS=…`), which on
purpose does not change the version, or whenever a file looks stale after an
extraction. The same goes for browsers: a scoped run needs a hard reload.

## Gotchas

- **A `types` block in nginx replaces the inherited types in `server` or
  `location`.** The additions in `nginx.conf` sit at http level, where they add
  to `mime.types` instead. Moved into `server`, every other type would become
  `application/octet-stream`.
- **`add_header` in a location drops every inherited `add_header`.** Each
  location in `nginx.conf` repeats its CORS and `Timing-Allow-Origin` headers
  for that reason. The gzip settings are not `add_header` and apply everywhere.
- **`gzip_proxied any` matters.** nginx's default refuses to compress any
  request with a `Via` header, and a proxy in front may add one.
- **nginx drops ranges on on-the-fly gzip** and answers with the whole
  compressed file. That is why audio is not on `gzip_types`.
- **Fastify's automatic HEAD route runs the GET handler** and resets
  `Content-Length` to 0 for an empty body, so `serveAssetDir` declares HEAD
  itself.
- **`gzip -k` copies the original's mtime at microsecond precision**, so the
  `.gz` reads a fraction of a millisecond older than its source. The Node
  servers compare in whole seconds.
