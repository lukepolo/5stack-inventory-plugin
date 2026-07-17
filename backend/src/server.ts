// Legacy entry shim — the real server lives in main.ts. Kept because some
// environments (and the codepier pod, whose package.json sync can conflict
// with pod-side npm writes) still launch `src/server.ts`.
import "./main.ts";
