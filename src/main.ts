// Standalone dev entry. In production the 5stack host loads ./App directly via
// Module Federation (this file is not used there).
import { createApp } from "vue";
import App from "./App.vue";

// Global preflight for standalone dev only — outside the panel nothing has
// reset UA styles. The host applies its own when embedded, and shipping
// preflight is what damaged the panel chrome, so the guard keeps it out of the
// production bundle entirely.
if (import.meta.env.DEV) {
  import("@5stack/ui/standalone.css");
}

const devUser = {
  steam_id: "76561197960265728",
  name: "Dev User",
  role: "administrator",
};

createApp(App, { user: devUser }).mount("#app");
