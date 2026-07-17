declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

// @5stack/ui ships CSS as a side-effect import.
declare module "@5stack/ui/plugin.css";
declare module "@5stack/ui/standalone.css";
