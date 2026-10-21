"""Halve a Radiance .hdr (RGBE) panorama: 2x2 box filter in linear light.

    python3 tools/hdr-half.py venice_sunset_1k.hdr src/assets/venice_sunset_512.hdr

This is how src/assets/venice_sunset_512.hdr was made from Poly Haven's
1k file (see src/assets/README.md). The viewer widens it back to 1024 before
prefiltering (upsampleStudioHdr in src/viewer3d.ts), so a change here has to
be re-measured against the 1k file on card bakes, never judged by eye.

Standard library only: reads flat or new-style RLE scanlines, writes RLE.
"""
import math
import sys


def read_hdr(path):
    data = open(path, "rb").read()
    i = 0
    while True:  # header lines, up to the blank one
        j = data.index(b"\n", i)
        line = data[i:j]
        i = j + 1
        if line == b"":
            break
    j = data.index(b"\n", i)
    res = data[i:j].split()
    i = j + 1
    if res[0] != b"-Y" or res[2] != b"+X":
        raise SystemExit(f"unsupported orientation {res!r}")
    h, w = int(res[1]), int(res[3])
    out = bytearray(w * h * 4)
    p = i
    for y in range(h):
        row = y * w * 4
        if 8 <= w < 32768 and data[p] == 2 and data[p + 1] == 2 and (data[p + 2] << 8 | data[p + 3]) == w:
            p += 4
            for c in range(4):
                x = 0
                while x < w:
                    n = data[p]
                    p += 1
                    if n > 128:
                        n -= 128
                        v = data[p]
                        p += 1
                        for k in range(n):
                            out[row + (x + k) * 4 + c] = v
                    else:
                        for k in range(n):
                            out[row + (x + k) * 4 + c] = data[p + k]
                        p += n
                    x += n
        else:
            out[row:row + w * 4] = data[p:p + w * 4]
            p += w * 4
    return w, h, out


def to_float(r, g, b, e):
    if e == 0:
        return 0.0, 0.0, 0.0
    f = math.ldexp(1.0, e - 136)
    return r * f, g * f, b * f


def to_rgbe(r, g, b):
    v = max(r, g, b)
    if v < 1e-32:
        return 0, 0, 0, 0
    m, e = math.frexp(v)
    s = m * 256.0 / v
    return int(r * s), int(g * s), int(b * s), e + 128


def write_hdr(path, w, h, rgbe):
    out = bytearray(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n" + f"-Y {h} +X {w}\n".encode())
    for y in range(h):
        out += bytes([2, 2, w >> 8, w & 255])
        for c in range(4):
            ch = bytes(rgbe[(y * w + x) * 4 + c] for x in range(w))
            x = 0
            while x < w:
                run = 1
                while x + run < w and run < 127 and ch[x + run] == ch[x]:
                    run += 1
                if run >= 4:
                    out += bytes([128 + run, ch[x]])
                    x += run
                    continue
                start, n = x, 0
                while x < w and n < 128:
                    r2 = 1
                    while x + r2 < w and r2 < 4 and ch[x + r2] == ch[x]:
                        r2 += 1
                    if r2 >= 4:
                        break
                    x += 1
                    n += 1
                out += bytes([n]) + ch[start:start + n]
    open(path, "wb").write(out)


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    w, h, rgbe = read_hdr(sys.argv[1])
    nw, nh = w // 2, h // 2
    out = bytearray(nw * nh * 4)
    for y in range(nh):
        for x in range(nw):
            acc = [0.0, 0.0, 0.0]
            for dy in (0, 1):
                for dx in (0, 1):
                    i = ((2 * y + dy) * w + 2 * x + dx) * 4
                    f = to_float(*rgbe[i:i + 4])
                    acc = [acc[k] + f[k] for k in range(3)]
            o = (y * nw + x) * 4
            out[o:o + 4] = bytes(to_rgbe(*(a / 4 for a in acc)))
    write_hdr(sys.argv[2], nw, nh, out)
    print(f"{w}x{h} -> {nw}x{nh}")


main()
