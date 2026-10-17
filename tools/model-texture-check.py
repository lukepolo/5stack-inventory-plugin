#!/usr/bin/env python3
"""Exercise the real embedded model-texture stage with bounded process memory."""
from pathlib import Path
import hashlib
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get("INVENTORY_TEST_SCRIPT", ROOT / "scripts/extract-models.sh")).read_text()
STAGE = SOURCE.split('# ---- 3a2.', 1)[1].split("python3 - <<'PYEOF'\n", 1)[1].split("\nPYEOF", 1)[0]
LIMIT = 64 * 1024 * 1024
RUNNER = """
import resource,runpy,json,sys
if sys.platform.startswith('linux'):
    resource.setrlimit(resource.RLIMIT_AS,(64*1024*1024,64*1024*1024))
runpy.run_path(sys.argv[1],run_name='__main__')
print(json.dumps({'peak_rss':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}))
"""
CONVERTER = """#!PYTHON
import pathlib,sys
a=sys.argv[1:]
assert a[:4]==['-exact','-lossless','-q','100'],a
src=pathlib.Path(a[4])
if src.name=='failed.png':sys.exit(7)
pathlib.Path(a[a.index('-o')+1]).write_bytes(b'RIFFfixtureWEBP'+src.read_bytes())
"""

def glb(path, images, binary=1024, padding=0):
    doc = {"asset": {"version": "2.0"}, "images": [{"uri": p, "mimeType": "image/png"} for p in images]}
    if padding:
        doc["extras"] = {"padding": "x" * padding}
    data = json.dumps(doc).encode()
    data += b" " * (-len(data) % 4)
    binary += -binary % 4
    tail = b"sentinel"
    total = 20 + len(data) + 8 + binary + 8 + len(tail)
    with path.open("wb") as f:
        f.write(b"glTF" + struct.pack("<IIII", 2, total, len(data), 0x4E4F534A))
        f.write(data)
        f.write(struct.pack("<I4s", binary, b"BIN\0"))
        f.write(b"mesh")
        f.seek(binary - 4, 1)
        f.write(struct.pack("<I4s", len(tail), b"TEST"))
        f.write(tail)

def read_json(path):
    with path.open("rb") as f:
        header = f.read(20)
        magic, version, total, length, kind = struct.unpack("<4sIIII", header)
        assert magic == b"glTF" and version == 2 and total == path.stat().st_size and kind == 0x4E4F534A
        return json.loads(f.read(length))

def trailing_hash(path):
    with path.open("rb") as f:
        f.seek(12)
        length = struct.unpack("<I", f.read(4))[0]
        f.seek(20 + length)
        h = hashlib.sha256()
        for part in iter(lambda: f.read(1024 * 1024), b""):
            h.update(part)
        return h.hexdigest()

class ModelTextures(unittest.TestCase):
    observed_peaks = []
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="inventory-model-textures-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dest = self.root / "models"
        self.dest.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.stage = self.root / "stage.py"
        self.stage.write_text(STAGE)
        converter = self.bin / "cwebp"
        converter.write_text(CONVERTER.replace("PYTHON", sys.executable, 1))
        converter.chmod(0o755)
        self.progress = self.root / "progress.json"
        self.progress.write_text(json.dumps({"steps": [{"name": "model-textures", "state": "running"}]}))
        self.jobs = self.root / "jobs"
        self.jobs.write_text("1")

    def run_stage(self, converter=True, success=True):
        env = {**os.environ, "DEST": str(self.dest), "PROGRESS_FILE": str(self.progress),
               "JOBS_FILE": str(self.jobs), "EXTRACT_JOBS": "1", "CORES": "1",
               "PATH": str(self.bin) if converter else str(self.root / "no-tools")}
        result = subprocess.run([sys.executable, "-c", RUNNER, str(self.stage)], env=env,
                                capture_output=True, text=True, timeout=90)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr[-3000:])
            peak = json.loads(result.stdout.splitlines()[-1])["peak_rss"]
            self.observed_peaks.append(peak)
            if sys.platform.startswith("linux"):
                self.assertLess(peak * 1024, LIMIT)
        else:
            self.assertNotEqual(result.returncode, 0)
        return result

    def texture(self, name="shared.png"):
        (self.dest / name).write_bytes(b"fixture pixels")

    def test_large_binary_payloads_are_streamed_and_preserved(self):
        self.texture()
        originals = {}
        for name in ["a.glb", "b.glb"]:
            path = self.dest / name
            glb(path, ["shared.png"], binary=96 * 1024 * 1024)
            originals[name] = trailing_hash(path)
        self.run_stage()
        for name, digest in originals.items():
            self.assertEqual(read_json(self.dest / name)["images"], [{"uri": "shared.webp", "mimeType": "image/webp"}])
            self.assertEqual(trailing_hash(self.dest / name), digest)
        self.assertFalse((self.dest / "shared.png").exists())

    def test_model_json_is_not_cached_across_the_catalogue(self):
        self.texture()
        for i in range(18):
            glb(self.dest / f"model-{i}.glb", ["shared.png"], padding=3 * 1024 * 1024)
        self.run_stage()
        for path in self.dest.glob("*.glb"):
            self.assertEqual(read_json(path)["images"][0]["uri"], "shared.webp")

    def test_no_encoder_keeps_original_references_and_buffers(self):
        self.texture()
        path = self.dest / "large.glb"
        glb(path, ["shared.png"], binary=96 * 1024 * 1024)
        before = trailing_hash(path)
        self.run_stage(converter=False)
        self.assertEqual(read_json(path)["images"][0]["uri"], "shared.png")
        self.assertEqual(trailing_hash(path), before)
        self.assertTrue((self.dest / "shared.png").exists())

    def test_failed_or_missing_texture_stays_png(self):
        for name in ["shared.png", "failed.png"]:
            self.texture(name)
        path = self.dest / "mixed.glb"
        glb(path, ["shared.png", "failed.png", "missing.png"])
        self.run_stage()
        self.assertEqual([i["uri"] for i in read_json(path)["images"]], ["shared.webp", "failed.png", "missing.png"])
        self.assertTrue((self.dest / "failed.png").exists())
        self.assertFalse((self.dest / "shared.png").exists())

    def test_existing_webp_is_reused_without_encoder(self):
        self.texture()
        (self.dest / "shared.webp").write_bytes(b"already converted")
        (self.dest / "extract-version.json").write_text('{"version":33}')
        path = self.dest / "cached.glb"
        glb(path, ["shared.png"])
        self.run_stage(converter=False)
        self.assertEqual(read_json(path)["images"][0]["uri"], "shared.webp")
        self.assertEqual((self.dest / "shared.webp").read_bytes(), b"already converted")

    def test_failed_atomic_rewrite_never_deletes_referenced_png(self):
        self.texture()
        for name in ["a.glb", "b.glb"]:
            glb(self.dest / name, ["shared.png"])
        (self.dest / "b.glb.tmp").mkdir()
        self.run_stage(success=False)
        self.assertTrue((self.dest / "shared.png").exists())
        for path in self.dest.glob("*.glb"):
            self.assertTrue((self.dest / read_json(path)["images"][0]["uri"]).is_file())

    def test_non_glb_is_ignored(self):
        (self.dest / "invalid.glb").write_bytes(b"not a glb")
        self.run_stage()
        self.assertEqual((self.dest / "invalid.glb").read_bytes(), b"not a glb")

if __name__ == "__main__":
    result = unittest.main(verbosity=2, exit=False).result
    print(json.dumps({"tests": result.testsRun, "success": result.wasSuccessful(),
                      "linux_address_space_limit_bytes": LIMIT if sys.platform.startswith("linux") else None,
                      "largest_stage_peak_rss": max(ModelTextures.observed_peaks, default=0),
                      "peak_rss_unit": "KiB" if sys.platform.startswith("linux") else "bytes"}))
    sys.exit(0 if result.wasSuccessful() else 1)
