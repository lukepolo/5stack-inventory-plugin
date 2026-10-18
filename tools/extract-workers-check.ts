import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { extractWorkerLimit } from "../backend/src/extractWorkers.ts";

const source = readFileSync(new URL("../scripts/extract-models.sh", import.meta.url), "utf8");
const start = source.indexOf("CORES=$(nproc");
const end = source.indexOf("export JOBS_FILE CORES", start);
assert(start >= 0 && end > start);
const block = source.slice(start, end);
const scratch = mkdtempSync(path.join(os.tmpdir(), "extract-worker-limit-"));
try {
  const bin = path.join(scratch, "bin"); mkdirSync(bin);
  writeFileSync(path.join(bin, "nproc"), "#!/bin/sh\necho 12\n", { mode: 0o755 });
  const file = path.join(scratch, "jobs");
  let count = 0;
  for (const [configured, expected] of [
    [undefined, 12], ["", 12], ["1", 1], ["3", 3], ["99", 12],
    ["0", 1], ["-2", 1], ["1.5", 1], ["garbage", 1], ["01", 1],
    ["1000000000", 1], ["1+2", 1],
  ] as const) {
    assert.equal(extractWorkerLimit(12, configured), expected);
    const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, JOBS_FILE: file, EXTRACT_JOBS: "12" };
    delete env.INVENTORY_EXTRACT_MAX_JOBS;
    if (configured !== undefined) env.INVENTORY_EXTRACT_MAX_JOBS = configured;
    // The real shell function must cap both a live panel file and env fallback.
    for (const fileValue of ["12\n", "not-a-number\n"]) {
      writeFileSync(file, fileValue);
      const run = spawnSync("bash", ["-c", "set -euo pipefail\n" + block + "\nread_jobs\n"], { env, encoding: "utf8", timeout: 5000 });
      assert.ifError(run.error); assert.equal(run.status, 0, run.stderr);
      assert.equal(Number(run.stdout), expected, `${configured}: ${fileValue}`);
      count++;
    }
  }
  assert.equal(extractWorkerLimit(2, "3"), 2);
  assert.equal(extractWorkerLimit(0, "3"), 1);
  console.log(`PASS: API limit and ${count} actual shell worker-limit cases`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
