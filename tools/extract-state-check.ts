// A still-running extractor must not acquire a false restart error when the API
// loses its ChildProcess handle. Exercise persisted state with a real process.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readSavedExtractState, IDLE_STATE, type ExtractState } from "../backend/src/extractState.ts";

const dir = await mkdtemp(path.join(os.tmpdir(), "extract-state-check-"));
const file = path.join(dir, "extract-state.json");
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
const exited = once(child, "exit");
await once(child, "spawn");
const livePid = async () => {
  try { process.kill(child.pid!, 0); return child.pid!; } catch { return null; }
};
const unexpectedLookup = async (): Promise<number | null> => {
  throw new Error("Finished runs and an owned child do not need a PID lookup");
};
let checks = 0;
try {
  assert.deepEqual(await readSavedExtractState(file, false, livePid), IDLE_STATE);
  checks++;
  await writeFile(file, "not json");
  assert.deepEqual(await readSavedExtractState(file, false, livePid), IDLE_STATE);
  checks++;

  const running: ExtractState = { ...IDLE_STATE, state: "running", startedAt: "2026-10-01T00:00:00Z" };
  await writeFile(file, JSON.stringify(running));
  assert.deepEqual(await readSavedExtractState(file, true, unexpectedLookup), running);
  checks++;
  // A new API instance has no child handle, but the lock still identifies a
  // live extraction. Both its running state and null error must survive.
  assert.deepEqual(await readSavedExtractState(file, false, livePid), running);
  checks++;

  child.kill("SIGTERM");
  await exited;
  const interrupted = await readSavedExtractState(file, false, livePid);
  assert.equal(interrupted.state, "interrupted");
  assert.match(interrupted.error!, /restarted while extraction was running/);
  assert.equal(interrupted.startedAt, running.startedAt);
  checks++;

  for (const state of ["succeeded", "failed"] as const) {
    const saved: ExtractState = { ...running, state, finishedAt: "2026-10-01T00:01:00Z", exitCode: state === "failed" ? 1 : 0, error: state === "failed" ? "A genuine extraction failure" : null };
    await writeFile(file, JSON.stringify(saved));
    assert.deepEqual(await readSavedExtractState(file, false, unexpectedLookup), saved);
    checks++;
  }
  console.log(`all ${checks} persisted extraction state checks pass`);
} finally {
  if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await exited; }
  await rm(dir, { recursive: true, force: true });
}
