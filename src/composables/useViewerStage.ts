// The 3D stage's own keyboard, and fullscreen.
//
// Everything here is about the STAGE — the box the model is drawn in — rather
// than about the model, which is why it is not on the viewer handle. Fullscreen
// is a property of the frame around the render; reset/flip are the handle's, and
// are bound here only because a key binding is a stage concern wherever the work
// ends up happening.
//
// WHY A COMPOSABLE AND NOT MARKUP IN App.vue: there are four viewer slots (the
// craft modal, the focus stage, the loadout overlay, the attachment preview) and
// the first two both want this. App.vue is already 9,500 lines; a second copy of
// a keydown handler with a subtly different input guard is exactly the kind of
// drift `useViewerMount` was written to end.
//
// THE KEYS ARE THE BUTTONS. `keys` is one table: the handler switches on it and
// ViewerControls draws it, so a binding cannot be added without growing a button
// or removed while one still advertises it. The legend this replaces went stale
// precisely because the gesture and its description were written down twice.
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import type { ViewerHandle } from "../viewer3d";

/**
 * Semantic icon name. Deliberately not a component: this module has no business
 * importing an icon set, and a caller that wants to draw these its own way
 * should not have to unpick one. ViewerControls owns the mapping.
 */
export type StageIcon = "reset" | "flip" | "expand" | "collapse" | "fire" | "reload" | "inspect" | "deploy";

export interface StageKey {
  /** Matched against a lowercased `KeyboardEvent.key`. */
  key: string;
  /** What the legend draws in the key cap. Usually `key` upper-cased. */
  cap: string;
  label: string;
  icon: StageIcon;
  run: () => void;
  /**
   * A key that WORKS but is not drawn in the legend.
   *
   * For a shortcut whose control lives somewhere else on the page: V still
   * puts the weapon in your hands, but the thing that says so is the stage
   * strip at the top, and printing it twice makes it look like two features.
   */
  hidden?: boolean;
  /**
   * Fires on key-up / pointer-up, making `run`/`release` a HOLD pair — the
   * fire button needs it for full auto. A key that declares this also ignores
   * the OS key-repeat, which would otherwise re-run at the keyboard's cadence
   * instead of the weapon's.
   */
  release?: () => void;
  /** Lit — the action is currently engaged (fullscreen, flipped). */
  on?: boolean;
  /** Unbound AND hidden from the legend when this returns false. */
  when?: () => boolean;
}

export interface ViewerStageSpec {
  /** The element that goes fullscreen — the stage box, not the canvas host:
   *  the canvas is `position:absolute; inset:0` inside it and would take its
   *  overlays (the loading spinner, the pills) out of the fullscreen subtree. */
  stage: () => HTMLElement | null;
  /** The live viewer, for the camera keys. Null disables just those. */
  handle: () => ViewerHandle | null;
  /** Only while this is true are the keys bound at all. */
  enabled: () => boolean;
  /** True when a fixed viewmodel camera is showing, so the orbit controls are
   *  hidden and their keys freed for the weapon actions. */
  viewmodel?: () => boolean;
  /**
   * Stage-specific rows, appended after the built-ins.
   *
   * A GETTER, not an array: these carry live state — a first-person toggle has
   * to relabel itself and light up when it is on — and a plain array captured at
   * setup would be a snapshot that never changes.
   */
  extraKeys?: () => StageKey[];
}

/**
 * Is this event aimed at a text field?
 *
 * Same test App.vue's `onGlobalKey` makes, and it has to stay the same test: a
 * name tag is a plain `<input>` inside the very modal these keys belong to, so
 * without this, typing "Reset" into it resets the camera four times.
 */
function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export function useViewerStage(spec: ViewerStageSpec) {
  // Same injection ViewerControls makes, and for the same reason: these labels
  // are drawn in its bar, so a mix of translated gesture cells and untranslated
  // button cells would show up in one row.
  const tr = inject<(k: string, f: string) => string>("tr", (_k, f) => f);
  const fullscreen = ref(false);

  /**
   * Whether the browser will do fullscreen here at all.
   *
   * Checked rather than assumed because the answer is not ours to know: we are
   * a federated remote inside the 5stack panel, and although we render into the
   * host DOCUMENT (not an iframe, so no `allow=` negotiation is needed), a host
   * that ever moves us into one would turn this off without warning. A button
   * that silently does nothing is worse than no button.
   */
  const canFullscreen = () =>
    typeof document !== "undefined" && (document.fullscreenEnabled ?? false);

  async function toggleFullscreen() {
    const el = spec.stage();
    if (!el || !canFullscreen()) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      // Rejects when the gesture is not trusted (a synthetic click, a call from
      // a timer). Nothing to recover — `fullscreenchange` never fires, so the
      // flag below stays honest on its own.
    }
  }

  /**
   * The flag follows the BROWSER, never the click.
   *
   * Escape, F11 and the host navigating away all leave fullscreen without going
   * through `toggleFullscreen`, so tracking our own intent gives a button stuck
   * reading "exit" over a window that is no longer full. The event is the only
   * source of truth.
   */
  function onFullscreenChange() {
    const el = spec.stage();
    fullscreen.value = !!el && document.fullscreenElement === el;
  }

  function onKey(e: KeyboardEvent) {
    if (!spec.enabled() || typing(e)) return;
    // Modified keys belong to the browser and to the host panel — Cmd+R is
    // reload, and rebinding it to "reset camera" is a way to lose someone's
    // half-finished craft.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Escape leaves fullscreen on its own and is App.vue's close-the-modal key
    // besides. Letting it through to both would close the craft sheet AND
    // un-fullscreen in one press, which reads as the modal jumping.
    if (e.key === "Escape") return;
    const k = e.key.toLowerCase();
    const hit = keys.value.find((b) => b.key === k);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    // Hold keys handle their own cadence — the OS repeat is not a trigger.
    if (e.repeat && hit.release) return;
    hit.run();
  }
  function onKeyUp(e: KeyboardEvent) {
    if (!spec.enabled()) return;
    const hit = keys.value.find((b) => b.key === e.key.toLowerCase());
    hit?.release?.();
  }

  /**
   * Which face is showing.
   *
   * ONE toggle rather than separate Front and Back actions. The two are not
   * things you choose between — you are looking at a weapon and you want to see
   * its other side — so a pair of buttons where one is always a no-op is a
   * worse answer than a single one that always does something. Reset puts it
   * back to front, so the flag has to clear there too or the next flip goes the
   * wrong way.
   */
  const flipped = ref(false);

  function reset() {
    flipped.value = false;
    spec.handle()?.resetCamera("home");
  }
  function flip() {
    flipped.value = !flipped.value;
    spec.handle()?.resetCamera(flipped.value ? "back" : "front");
  }

  /** Built-ins, then the caller's. Recomputed so `when` and `on` stay live. */
  const keys = computed<StageKey[]>(() => {
    const has = !!spec.handle();
    // Reset and flip ORBIT a camera. First person has no orbit — the eye is
    // pinned where the clip puts it — so offering them there is two buttons
    // that do nothing, and it costs the R and F keys that the weapon actions
    // want (CS2 binds reload to R and inspect to F).
    const orbiting = has && !spec.viewmodel?.();
    const rows: StageKey[] = [
      {
        key: "r",
        cap: "R",
        label: tr("inventory.viewer.controls.reset", "Reset camera"),
        icon: "reset",
        run: reset,
        when: () => orbiting,
      },
      {
        key: "b",
        cap: "B",
        label: flipped.value
          ? tr("inventory.viewer.controls.flip_front", "Show the front")
          : tr("inventory.viewer.controls.flip_back", "Show the other side"),
        icon: "flip",
        on: flipped.value,
        run: flip,
        when: () => orbiting,
      },
    ];
    if (canFullscreen()) {
      rows.push({
        key: "f",
        cap: "F",
        label: fullscreen.value
          ? tr("inventory.viewer.controls.fullscreen_exit", "Exit fullscreen")
          : tr("inventory.viewer.controls.fullscreen", "Fullscreen"),
        icon: fullscreen.value ? "collapse" : "expand",
        on: fullscreen.value,
        run: () => void toggleFullscreen(),
      });
    }
    return [...rows, ...(spec.extraKeys?.() ?? [])].filter((b) => b.when?.() ?? true);
  });

  // Listeners live only while the stage is up. A window keydown handler that
  // outlives its modal is how a closed sheet keeps eating "h".
  watch(
    () => spec.enabled(),
    (on) => {
      if (on) {
        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKeyUp);
        document.addEventListener("fullscreenchange", onFullscreenChange);
      } else {
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keyup", onKeyUp);
        document.removeEventListener("fullscreenchange", onFullscreenChange);
        // Leaving the stage while it owns the screen would strand the whole
        // panel in a fullscreen element that is about to be unmounted.
        if (document.fullscreenElement && document.fullscreenElement === spec.stage()) {
          void document.exitFullscreen().catch(() => {});
        }
        fullscreen.value = false;
        // A fresh mount opens on the front, so a stale flag would invert the
        // first press.
        flipped.value = false;
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKeyUp);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
  });

  return { fullscreen, canFullscreen, toggleFullscreen, flipped, keys };
}
