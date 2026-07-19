#!/usr/bin/env python3
"""Software-rasterize the P90 body and color every screen pixel by its
noPaint signature group, so 'which rule paints the sights vs the block'
stops being an eyeballing contest.

Groups within ao.a > 0.5:
  1 masked   & metal      -> yellow
  2 masked   & non-metal  -> red
  3 unmasked & non-metal  -> blue
  4 unmasked & metal      -> green
Painted area (ao.a <= 0.5) -> the base camo tone (dim).
"""
import json, struct
import numpy as np
from PIL import Image, ImageDraw

GLB = "/Users/luke/Downloads/cs2-model-extract/models/p90.glb"
INP = "/Users/luke/Downloads/cs2-model-extract/models/p90.inputs"
W, H = 900, 560

d = open(GLB, "rb").read()
n = struct.unpack("<I", d[12:16])[0]
j = json.loads(d[20:20+n]); binoff = 20 + n + 8
def acc(i):
    a = j["accessors"][i]; bv = j["bufferViews"][a["bufferView"]]
    off = binoff + bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    ct = {5126: "f", 5123: "H", 5125: "I"}[a["componentType"]]
    nc = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    return np.array(struct.unpack_from("<" + ct * (a["count"] * nc), d, off)).reshape(a["count"], nc)

prim = j["meshes"][1]["primitives"][0]  # body_hd
uv  = acc(prim["attributes"]["TEXCOORD_0"])
pos = acc(prim["attributes"]["POSITION"])
idx = acc(prim["indices"]).ravel()

def tex_ch(f, i, size=1024):
    im = Image.open(f).convert("RGBA")
    return np.asarray(im.getchannel(i).resize((size, size), Image.BILINEAR)).astype(float) / 255

noP = tex_ch(f"{INP}/ao.png", 3)
mr, mg, mb = [tex_ch(f"{INP}/masks.png", i) for i in range(3)]
mmax = np.maximum(mr, np.maximum(mg, mb))
metal = tex_ch(f"{INP}/metalness.png", 1)
TS = noP.shape[0]

# Camera: match the viewer's rough angle (left-front-above, muzzle left).
yaw, pitch = np.deg2rad(35), np.deg2rad(-12)
Ry = np.array([[np.cos(yaw), 0, np.sin(yaw)], [0, 1, 0], [-np.sin(yaw), 0, np.cos(yaw)]])
Rx = np.array([[1, 0, 0], [0, np.cos(pitch), -np.sin(pitch)], [0, np.sin(pitch), np.cos(pitch)]])
R = Rx @ Ry
# glTF Y-up; weapon points +X. Rotate so it lies like the screenshots.
P = pos @ R.T
lo, hi = P.min(axis=0), P.max(axis=0)
span = hi - lo
scale = min((W - 60) / span[0], (H - 60) / span[1])
sx = (P[:, 0] - lo[0]) * scale + 30
sy = H - ((P[:, 1] - lo[1]) * scale + 30)
depth = P[:, 2]

zbuf = np.full((H, W), -1e9)
gbuf = np.zeros((H, W), dtype=np.uint8)  # 0 empty, 5 painted, 1..4 groups

tri_i = idx.reshape(-1, 3)
for k0, k1, k2 in tri_i:
    xs = np.array([sx[k0], sx[k1], sx[k2]]); ys = np.array([sy[k0], sy[k1], sy[k2]])
    zs = np.array([depth[k0], depth[k1], depth[k2]])
    minx, maxx = int(max(0, xs.min())), int(min(W - 1, xs.max()))
    miny, maxy = int(max(0, ys.min())), int(min(H - 1, ys.max()))
    if maxx < minx or maxy < miny: continue
    X, Y = np.meshgrid(np.arange(minx, maxx + 1), np.arange(miny, maxy + 1))
    x1, y1, x2, y2, x3, y3 = xs[0], ys[0], xs[1], ys[1], xs[2], ys[2]
    den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
    if abs(den) < 1e-9: continue
    a = ((y2 - y3) * (X - x3) + (x3 - x2) * (Y - y3)) / den
    b = ((y3 - y1) * (X - x3) + (x1 - x3) * (Y - y3)) / den
    c = 1 - a - b
    m = (a >= 0) & (b >= 0) & (c >= 0)
    if not m.any(): continue
    z = a * zs[0] + b * zs[1] + c * zs[2]
    u = a * uv[k0][0] + b * uv[k1][0] + c * uv[k2][0]
    v = a * uv[k0][1] + b * uv[k1][1] + c * uv[k2][1]
    upd = m & (z > zbuf[miny:maxy + 1, minx:maxx + 1])
    if not upd.any(): continue
    tu = np.clip((u * TS).astype(int) % TS, 0, TS - 1)
    tv = np.clip((v * TS).astype(int) % TS, 0, TS - 1)
    np_ = noP[tv, tu]; mm = mmax[tv, tu]; me = metal[tv, tu]
    g = np.where(np_ > 0.5,
                 np.where(mm > 0.5, np.where(me > 0.5, 1, 2), np.where(me > 0.5, 4, 3)),
                 5).astype(np.uint8)
    zb = zbuf[miny:maxy + 1, minx:maxx + 1]
    gb = gbuf[miny:maxy + 1, minx:maxx + 1]
    zb[upd] = z[upd]; gb[upd] = g[upd]

pal = {0: (18, 18, 20), 5: (120, 104, 78),
       1: (255, 220, 40), 2: (235, 60, 40), 3: (60, 110, 255), 4: (40, 220, 90)}
img = np.zeros((H, W, 3), dtype=np.uint8)
for g, col in pal.items():
    img[gbuf == g] = col
out = Image.fromarray(img)
d2 = ImageDraw.Draw(out)
d2.text((10, 6), "P90 by noPaint signature:  YELLOW masked+metal | RED masked | BLUE unmasked | GREEN unmasked+metal | tan = painted", fill=(255, 255, 255))
out.save("p90_groups3d.png")
vis, cnt = np.unique(gbuf[gbuf > 0], return_counts=True)
tot = cnt.sum()
for g, c in zip(vis, cnt):
    name = {1: "masked+metal", 2: "masked+nonmetal", 3: "unmasked+nonmetal", 4: "unmasked+metal", 5: "painted"}[g]
    print(f"group {g} {name:18s} {c/tot*100:5.1f}% of visible pixels")
