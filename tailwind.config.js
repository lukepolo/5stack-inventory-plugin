/** @type {import('tailwindcss').Config} */
module.exports = {
  // The plugin preset owns darkMode, the `important: "[data-5stack-plugin]"`
  // utility scoping (this plugin's CSS is injected after the host panel's, so
  // an unscoped `.hidden` would nuke the panel nav), and the @5stack/ui content
  // glob. Anchor the attribute on the root element — see App.vue.
  presets: [require("@5stack/ui/tailwind-plugin-preset")],
  content: ["./index.html", "./src/**/*.{vue,ts}"],
  theme: {
    extend: {
      keyframes: {
        float: {
          "0%,100%": { transform: "translateY(-4px)" },
          "50%": { transform: "translateY(4px)" },
        },
        // View/panel entrances. Declared as named animations because arbitrary
        // `animate-[...]` values with decimals get mangled in this remote's
        // injected CSS (same reason as the fontSize/letterSpacing tokens).
        rise: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "none" },
        },
        popIn: {
          from: { opacity: "0", transform: "translateY(8px) scale(0.985)" },
          to: { opacity: "1", transform: "none" },
        },
        // Modal/overlay motion. Exits are deliberately shorter than entrances
        // and use an ease-IN curve: a dialog should feel like it snaps away
        // once you've decided, but settle gently when it arrives.
        popOut: {
          from: { opacity: "1", transform: "none" },
          to: { opacity: "0", transform: "translateY(4px) scale(0.99)" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        fadeOut: {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        // Context menus hang off the cursor, so they scale from their own
        // corner rather than drifting — pair with `origin-top-left`.
        menuIn: {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        rise: "rise 260ms cubic-bezier(0.22,1,0.36,1) both",
        "pop-in": "popIn 200ms cubic-bezier(0.22,1,0.36,1) both",
        "pop-out": "popOut 130ms cubic-bezier(0.4,0,1,1) both",
        "fade-in": "fadeIn 160ms ease-out both",
        "fade-out": "fadeOut 130ms ease-in both",
        "menu-in": "menuIn 110ms cubic-bezier(0.22,1,0.36,1) both",
      },
      // Named tracking tokens — arbitrary `tracking-[0.14em]` classes break in
      // this remote's injected CSS (the escaped decimal point is mangled), so we
      // use decimal-free class names instead.
      letterSpacing: {
        cs1: "0.1em",
        cs2: "0.14em",
        cs3: "0.18em",
        cs4: "0.2em",
        cs5: "0.26em",
        cs6: "0.3em",
      },
      // Small font sizes — arbitrary `text-[9px]` classes get mangled in this
      // remote's injected CSS (escaped brackets/decimals), so use named tokens.
      fontSize: {
        f8: "8px",
        f9: "9px",
        f10: "10px",
        f11: "11px",
        f13: "13px",
      },
    },
  },
};
