import { readFile } from "node:fs/promises";
import os from "node:os";

type Sources = {
  meminfo: () => Promise<string>;
  hostTotal: () => number;
  hostFree: () => number;
  constrained: () => number;
  available: () => number;
};

const nativeSources: Sources = {
  meminfo: () => readFile("/proc/meminfo", "utf8"),
  hostTotal: os.totalmem,
  hostFree: os.freemem,
  constrained: () => process.constrainedMemory(),
  available: () => process.availableMemory(),
};

/** /proc/meminfo and os.totalmem() describe the host even inside a container.
 * Node's libuv-backed process APIs apply the OS/cgroup limit and current usage.
 * Keep MemAvailable as a host-pressure ceiling, not as the container's budget. */
export async function machineMemoryMb(source: Sources = nativeSources): Promise<{
  totalMb: number | null;
  availableMb: number | null;
  scope: "host" | "container";
}> {
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  const nonnegative = (n: number) => Number.isFinite(n) && n >= 0;
  let hostTotal = source.hostTotal();
  let hostAvailable = source.hostFree();
  try {
    const text = await source.meminfo();
    const field = (name: string) => {
      const match = new RegExp(`^${name}:\\s+(\\d+) kB`, "m").exec(text);
      return match ? Number(match[1]) * 1024 : NaN;
    };
    if (positive(field("MemTotal"))) hostTotal = field("MemTotal");
    if (nonnegative(field("MemAvailable"))) hostAvailable = field("MemAvailable");
  } catch {
    // Non-Linux hosts still have the os module readings above.
  }
  const limit = source.constrained(); // 0 means unknown or unconstrained.
  const processAvailable = source.available();
  const constrained = positive(limit) && (!positive(hostTotal) || limit < hostTotal);
  const total = constrained ? limit : hostTotal;
  // If a constrained runtime cannot report remaining memory, do not replace it
  // with host free memory. That would tell an operator a worker fits when it may not.
  const candidates = [total, hostAvailable, processAvailable].filter(nonnegative);
  const available = constrained && !nonnegative(processAvailable)
    ? null
    : candidates.length ? Math.min(...candidates) : null;
  return {
    totalMb: positive(total) ? Math.floor(total / 1024 / 1024) : null,
    availableMb: available == null ? null : Math.floor(available / 1024 / 1024),
    scope: constrained ? "container" : "host",
  };
}
