<script setup lang="ts">
// The panel's tooltip, ported for this remote.
//
// Same primitive (reka-ui) and same look as web/components/ui/tooltip — card
// surface, hairline border, amber left rule — so a hover here reads as part of
// 5stack rather than a browser `title=` popup appearing half a second late in
// the OS font.
//
// Two deviations from web's copy, both forced by this being a federated remote:
//
//   1. The portal target. Our utilities are scoped `[data-5stack-plugin] .x`
//      (see tailwind-plugin-preset), so content teleported to <body> — reka's
//      default — would land outside that selector and render completely
//      unstyled. Portalling to the plugin root keeps it inside the scope while
//      still escaping the toolbar's stacking/clipping context.
//   2. The surface is an inline style and the left rule is a real element.
//      Arbitrary classes carrying decimals (`bg-[hsl(var(--card)/0.97)]`,
//      `before:content-['']`) get mangled in this remote's injected CSS — the
//      same reason the fontSize/letterSpacing tokens exist in tailwind.config.
//
// Provider is per-instance rather than app-wide: reka's TooltipRoot throws
// without one, and a single wrapper at App's root wouldn't cover the pieces
// that mount through their own trees. The cost is that the skip-delay doesn't
// chain between adjacent triggers.
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipProvider,
} from "reka-ui";

withDefaults(
  defineProps<{
    text: string;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    /** Hover dwell before it opens. Matches web's 500ms default. */
    delay?: number;
  }>(),
  { side: "bottom", sideOffset: 6, delay: 500 },
);
</script>

<template>
  <TooltipProvider :delay-duration="delay" :skip-delay-duration="300" disable-hoverable-content>
    <TooltipRoot>
      <!-- as-child: the trigger IS the caller's button, so we add no wrapper
           box to the flex row we're being dropped into. -->
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal to="[data-5stack-plugin]">
        <TooltipContent
          :side="side"
          :side-offset="sideOffset"
          class="relative z-[1100] max-w-xs animate-pop-in overflow-hidden rounded-md border border-border py-1.5 pl-3 pr-3 text-f11 leading-snug text-foreground"
          style="background: hsl(var(--card) / 0.97); backdrop-filter: blur(6px); box-shadow: 0 8px 24px -8px hsl(var(--background) / 0.8)"
        >
          <span
            class="absolute inset-y-0 left-0 w-0.5"
            style="background: hsl(var(--tac-amber, 33 94% 58%))"
          ></span>
          <slot name="content">{{ text }}</slot>
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
