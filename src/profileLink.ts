// Floats a "View CS2 Loadout" chip on the panel's /players/:steamid pages.
//
// The remote only MOUNTS under its own routes, but once loaded its modules stay
// alive for the whole SPA session — so after the first visit we watch SPA
// navigations and inject an unobtrusive link on player profiles.
//
// This is still a workaround: the proper fix is a host-side extension point
// (plugins declaring a player-profile action in the registry), which needs
// a `custom_pages` column. Until then, keep it honest — event-driven, no polling
// loop, no hardcoded mount path, and removable.
let uninstall: (() => void) | null = null;

/** @param base where the host mounted us, e.g. "/apps/inventory". */
export function installProfileLink(base = "/apps/inventory") {
  const w = window as unknown as { __cs2InvProfileLink?: () => void };
  // Already installed (e.g. the remote re-mounted): just refresh the base.
  if (w.__cs2InvProfileLink) return;

  const CHIP_ID = "cs2-inv-profile-chip";

  const sync = () => {
    const match = window.location.pathname.match(/^\/players\/(\d{17})(?:\/|$)/);
    const existing = document.getElementById(CHIP_ID) as HTMLAnchorElement | null;
    if (!match) {
      existing?.remove();
      return;
    }
    const href = `${base}?player=${match[1]}`;
    if (existing) {
      existing.href = href;
      return;
    }
    const chip = document.createElement("a");
    chip.id = CHIP_ID;
    chip.href = href;
    chip.textContent = "View CS2 Loadout";
    Object.assign(chip.style, {
      position: "fixed",
      right: "18px",
      bottom: "18px",
      zIndex: "60",
      padding: "9px 15px",
      borderRadius: "4px",
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      textDecoration: "none",
      color: "#0a0e15",
      background:
        "linear-gradient(135deg, var(--tac-amber-cta-from, #f9b04a), var(--tac-amber-cta-to, #d97f16))",
      boxShadow: "0 2px 0 rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.45)",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(chip);
  };

  // vue-router drives every SPA navigation through pushState/replaceState, so
  // wrapping both (plus popstate for back/forward) covers all of them — the old
  // 1.5s setInterval fallback ran for the life of the session on every page of
  // the panel to catch a case these three don't miss.
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const wrap = <T extends (...args: never[]) => unknown>(fn: T): T =>
    function (this: unknown, ...args: never[]) {
      const result = fn.apply(this, args);
      queueMicrotask(sync);
      return result;
    } as T;
  history.pushState = wrap(originalPush.bind(history));
  history.replaceState = wrap(originalReplace.bind(history));
  window.addEventListener("popstate", sync);
  sync();

  uninstall = () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener("popstate", sync);
    document.getElementById(CHIP_ID)?.remove();
    uninstall = null;
    delete w.__cs2InvProfileLink;
  };
  w.__cs2InvProfileLink = uninstall;
}

/**
 * Deliberately NOT called on unmount — the chip's whole job is to exist on host
 * routes where the plugin isn't mounted. It's here so a teardown is possible
 * (tests, or a host that unloads remotes).
 */
export function uninstallProfileLink() {
  const w = window as unknown as { __cs2InvProfileLink?: () => void };
  w.__cs2InvProfileLink?.();
}
