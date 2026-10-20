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

// The stamp lives beside the bundle, which is normally the API host too. A build
// with an absolute `base` (PLUGIN_BASE, the GitHub Pages dev copy) is served from
// somewhere else while VITE_INVENTORY_API points at the live backend — reading
// the stamp from there would report the LIVE plugin's build, not this one.
const BUILD_INFO_URL = /^https?:\/\//.test(import.meta.env.BASE_URL)
  ? `${import.meta.env.BASE_URL}build-info.json`
  : `${API_ORIGIN}/build-info.json`;

export function useBuildCheck() {
  const serverBuild = ref("");
  const staleBuild = ref(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  async function check() {
    try {
      const res = await fetch(BUILD_INFO_URL, { cache: "no-store" });
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

  return { serverBuild, staleBuild, reloadPage: () => window.location.reload() };
}
