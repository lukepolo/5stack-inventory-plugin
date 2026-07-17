/**
 * Module Federation shared singletons. Only list packages this remote actually
 * depends on (federation builds a shared entry for each, so an uninstalled one
 * fails the build). Every key here must also be shared by the host
 * (web/lib/federation.shared.ts) and pinned to the same version, so exactly one
 * instance loads at runtime — a second copy of vue/reka-ui/@5stack-ui breaks
 * reactivity and component context. Add vue-router/pinia/@vueuse/core here (and
 * to package.json) only once this plugin imports them.
 */
export const FEDERATION_SHARED = {
  vue: { singleton: true, requiredVersion: false },
  "reka-ui": { singleton: true, requiredVersion: false },
  "lucide-vue-next": { singleton: true, requiredVersion: false },
  "class-variance-authority": { singleton: true, requiredVersion: false },
  "tailwind-merge": { singleton: true, requiredVersion: false },
  clsx: { singleton: true, requiredVersion: false },
  "@5stack/ui": { singleton: true, requiredVersion: false },
} as const;
