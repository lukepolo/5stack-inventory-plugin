/** An optional deployment ceiling for the memory-heavy decompile pool.
 * Unset keeps the existing CPU-count ceiling. Invalid explicit limits fail
 * closed to one worker rather than silently enabling host-wide concurrency. */
export function extractWorkerLimit(cores: number, configured?: string): number {
  const available = Number.isFinite(cores) ? Math.max(1, Math.floor(cores)) : 1;
  if (configured == null || configured === "") return available;
  if (!/^[1-9][0-9]{0,8}$/.test(configured)) return 1;
  return Math.min(available, Number(configured));
}
