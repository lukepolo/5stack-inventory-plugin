Set `INVENTORY_EXTRACT_MAX_JOBS=1` on an Inventory backend to restrict its
memory-heavy model decompile pool to one worker. Use a larger ceiling only
after qualifying that install's assets and memory budget.

The worker control advertises the configured ceiling, saved worker counts are
clamped to it, and updates above it are rejected. The extraction script also
enforces it for its live jobs file and environment fallback. Smaller texture
pools keep their existing limits. Unset or empty retains the existing CPU-count
ceiling; an invalid explicit value limits decompilation to one worker.

This does not reserve RAM or make the historical per-worker memory estimates
accurate for every asset. Provision memory separately and monitor the run.
