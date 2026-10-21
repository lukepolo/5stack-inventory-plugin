// Which build is the plugin server actually serving?
//
// Fetched fresh (no-store), logged, displayed in the gear dialog, and POLLED —
// if the server ships a newer bundle while this page is open, a banner says so.
// Staleness becomes a fact you can read, never a guess. This matters more than
// usual here: the panel cache-busts remoteEntry.js only on page load, so an
// already-open tab keeps running old code through any number of rebuilds.
import { onBeforeUnmount, onMounted, ref } from "vue";
import { API_ORIGIN } from "../api";

const POLL_MS = 30_000;

/**
 * When THIS bundle was built — the placeholder is replaced by the build-stamp
 * plugin (vite.config.ts) with the same time it writes to build-info.json.
 * Null on the dev server, where nothing builds a bundle. build-info.json alone
 * answers "what does the server have", which is not "what is this page
 * running": a page still on an old bundle saw the NEW time there, and there was
 * no way to tell from the panel that it needed a reload.
 */
const STAMP = "__CS2INV_BUILT_AT__";
export const BUNDLE_BUILT_AT: string | null = STAMP.startsWith("__") ? null : STAMP;

export function useBuildCheck() {
  const serverBuild = ref("");
  const staleBuild = ref(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  async function check() {
    try {
      const res = await fetch(`${API_ORIGIN}/build-info.json`, { cache: "no-store" });
      const { builtAt } = (await res.json()) as { builtAt?: string };
      if (!builtAt) return;
      if (!serverBuild.value) {
        serverBuild.value = builtAt;
        console.log(`[cs2-inventory] server bundle built at ${builtAt} (loaded ${new Date().toISOString()})`);
      } else if (builtAt !== serverBuild.value) {
        staleBuild.value = true; // server rebuilt since this page loaded
      }
    } catch {
      /* older server image without the stamp */
    }
  }

  onMounted(() => {
    void check();
    timer = setInterval(check, POLL_MS);
  });
  onBeforeUnmount(() => clearInterval(timer));

  return { serverBuild, staleBuild, bundleBuild: BUNDLE_BUILT_AT, reloadPage: () => window.location.reload() };
}
