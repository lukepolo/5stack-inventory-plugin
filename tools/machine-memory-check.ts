import assert from "node:assert/strict";
import { machineMemoryMb } from "../backend/src/machineMemory.ts";

const GiB = 1024 ** 3;
const base = {
  meminfo: async () => `MemTotal: ${64 * GiB / 1024} kB\nMemAvailable: ${40 * GiB / 1024} kB\n`,
  hostTotal: () => 64 * GiB,
  hostFree: () => 10 * GiB,
  constrained: () => 8 * GiB,
  available: () => 6 * GiB,
};
let cases = 0;
async function check(overrides: Partial<typeof base>, expected: Awaited<ReturnType<typeof machineMemoryMb>>) {
  assert.deepEqual(await machineMemoryMb({ ...base, ...overrides }), expected);
  cases++;
}
// An 8 GiB container on a 64 GiB host must never advertise the host's free 40 GiB.
await check({}, { totalMb: 8192, availableMb: 6144, scope: "container" });
await check({ available: () => 0 }, { totalMb: 8192, availableMb: 0, scope: "container" });
await check({ available: () => NaN }, { totalMb: 8192, availableMb: null, scope: "container" });
await check({ meminfo: async () => `MemTotal: ${64 * GiB / 1024} kB\nMemAvailable: ${GiB / 1024} kB\n` },
  { totalMb: 8192, availableMb: 1024, scope: "container" });
await check({ constrained: () => 0, available: () => 40 * GiB },
  { totalMb: 65536, availableMb: 40960, scope: "host" });
await check({ constrained: () => 128 * GiB, available: () => 80 * GiB },
  { totalMb: 65536, availableMb: 40960, scope: "host" });
await check({ meminfo: async () => { throw Error("not Linux"); } },
  { totalMb: 8192, availableMb: 6144, scope: "container" });
await check({ meminfo: async () => "malformed", constrained: () => 0, available: () => 12 * GiB },
  { totalMb: 65536, availableMb: 10240, scope: "host" });
await check({ available: () => 12 * GiB }, { totalMb: 8192, availableMb: 8192, scope: "container" });
console.log(`PASS: ${cases} container/host memory budget cases`);
