import { ref, type Ref } from "vue";
import { ApiError, type CraftCodeWire } from "../api";

type Tr = (k: string, f: string, n?: Record<string, unknown>) => string;

export function useMatOpen<Taken extends { stickers: unknown[] }>(o: {
  name: Ref<string | null>;
  outline: Ref<string>;
  clear: () => Taken;
  restore: (taken: Taken) => void;
  offerUndo: (label: string, undo: () => void) => void;
  say: (text: string) => void;
  tr: Tr;
  read: (code: string, signal: AbortSignal) => Promise<CraftCodeWire>;
  lay: (got: CraftCodeWire) => Promise<() => void>;
}) {
  /** Undo puts back the name and the chalk with the stickers: Update and Put on your … act on all three. */
  function replace(apply: () => void, what: string) {
    const before = { name: o.name.value, outline: o.outline.value };
    const taken = o.clear();
    apply();
    if (!taken.stickers.length) {
      o.say(what);
      return;
    }
    o.offerUndo(what, () => {
      o.clear();
      o.restore(taken);
      o.name.value = before.name;
      o.outline.value = before.outline;
    });
  }

  const importOpen = ref(false);
  const importText = ref("");
  const importBusy = ref(false);
  const importError = ref<string | null>(null);
  let inflight: AbortController | null = null;

  function closeImport() {
    inflight?.abort();
    inflight = null;
    importBusy.value = false;
    importError.value = null;
    importOpen.value = false;
  }
  function toggleImport() {
    if (importOpen.value) {
      closeImport();
    } else {
      importOpen.value = true;
    }
  }

  function refusal(e: unknown, reading: boolean): string {
    const reason = e instanceof ApiError ? (e.reason ?? (e.status === 401 ? "signed-out" : e.status === 413 ? "too-long" : null)) : reading ? "network" : null;
    switch (reason) {
      case "too-long":
        return o.tr("inventory.stickerCrafts.importTooLong", "That's too long to be an inspect code.");
      case "unmasked":
        return o.tr(
          "inventory.stickerCrafts.importUnmasked",
          "That link points at an item in someone's inventory, so it can't be read here. Paste the craft's Code from csinspect.com instead.",
        );
      case "not-a-code":
        return o.tr("inventory.stickerCrafts.importNotCode", "That isn't an inspect code. Paste the craft's Code from csinspect.com.");
      case "unreadable":
        return o.tr("inventory.stickerCrafts.importUnreadable", "That code couldn't be read. Copy it again; it may have been cut short.");
      case "not-a-gun":
        return o.tr("inventory.stickerCrafts.importNotGun", "That code isn't for a gun that takes stickers.");
      case "no-stickers":
        return o.tr("inventory.stickerCrafts.importNoStickers", "That code has no stickers this catalog knows.");
      case "signed-out":
        return o.tr("inventory.stickerCrafts.importSignedOut", "You're signed out. Sign in again, then import the code.");
      case "network":
        return o.tr("inventory.stickerCrafts.importOffline", "Couldn't reach the server. Check your connection and try again.");
      default:
        return o.tr("inventory.stickerCrafts.importFailed", "Couldn't read that code. Try again.");
    }
  }
  function note(count: number, skipped: number): string {
    if (!skipped) {
      return o.tr("inventory.stickerCrafts.importDone", "The code's stickers are on the mat. Save keeps them as your own craft.");
    }
    const done = count === 1
      ? o.tr("inventory.stickerCrafts.importedOne", "Imported 1 sticker.")
      : o.tr("inventory.stickerCrafts.importedMany", "Imported {count} stickers.", { count });
    const left = skipped === 1
      ? o.tr("inventory.stickerCrafts.leftOutOne", "1 couldn't be read and was left out.")
      : o.tr("inventory.stickerCrafts.leftOutMany", "{count} couldn't be read and were left out.", { count: skipped });
    return `${done} ${left}`;
  }

  async function importCode() {
    const code = importText.value.trim();
    if (!code || importBusy.value) {
      return;
    }
    const ctl = new AbortController();
    inflight = ctl;
    importBusy.value = true;
    importError.value = null;
    let reading = true;
    try {
      const got = await o.read(code, ctl.signal);
      reading = false;
      const apply = ctl.signal.aborted ? null : await o.lay(got);
      if (!apply || ctl.signal.aborted) {
        return;
      }
      replace(apply, note(got.stickers.length, got.skipped));
      importOpen.value = false;
      importText.value = "";
    } catch (e) {
      if (!ctl.signal.aborted) {
        importError.value = refusal(e, reading);
      }
    } finally {
      if (inflight === ctl) {
        inflight = null;
        importBusy.value = false;
      }
    }
  }

  return { replace, importOpen, importText, importBusy, importError, toggleImport, closeImport, importCode };
}
