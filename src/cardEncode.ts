// Card uploads as WebP, where this browser can make one.
//
// A baked card (snapshotModel in viewer3d.ts) is a PNG: lossless, with the
// transparent background the grid draws it over. Measured on 16 real bakes it
// is 0.2-1MB a card, so an inventory grid was megabytes of PNG. The same
// picture as a lossy WebP with a lossless alpha plane is about a tenth of that
// (see CARD_WEBP_QUALITY), and that is what the server now stores and serves.
//
// Encoding happens HERE, at the upload, not in the snapshot: the snapshot's PNG
// still feeds everything else that takes one (the card shown at once from a
// local object URL, the craft preview, the skin-test suite, a downloaded image),
// and only the copy that goes to the shared store changes format.
//
// Three cases, decided per upload:
//
//  - The server does not take WebP (its catalog has no `cardFormats`, i.e. a
//    backend from before WebP cards; it 400s anything that isn't a PNG): the
//    PNG goes, exactly as before.
//  - The browser cannot encode WebP. WebKit — every Safari, on every platform —
//    answers `toBlob("image/webp")` with a PNG and says nothing; Playwright's
//    WebKit 26 does it too. So the result is checked by its MAGIC BYTES, never
//    by asking for the type: the PNG goes, and a current server transcodes it
//    (cardStore.ts in the backend), so the stored card ends up a WebP anyway.
//  - Otherwise the WebP goes. If a server that advertised WebP refuses it
//    anyway, the PNG follows straight after and WebP is not tried again this
//    session.
//
// Nothing about the card's NAME changes: the key still ends in `.png`, and the
// server answers it with whichever format it stored (see renderKeyFor in
// api.ts). So the "already baked?" probe stays one request.

/**
 * Lossy quality for the card's colour; its alpha is always lossless. The same
 * number as the backend's CARD_WEBP_QUALITY (cardStore.ts, which has the
 * measurement): 90 is where the remaining error is the chroma subsampling every
 * lossy WebP has, PNG and WebP could not be told apart side by side at 2x, and
 * a card is about 10% of its PNG.
 */
export const CARD_WEBP_QUALITY = 0.9;

/** RIFF....WEBP: what a WebP file starts with, whatever the encoder claims. */
export async function isWebp(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const tag = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  return head.length === 12 && tag(0, 4) === "RIFF" && tag(8, 12) === "WEBP";
}

const canvasToBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", CARD_WEBP_QUALITY));

/**
 * Whether this browser's canvas encodes WebP at all — asked once, on a single
 * pixel, so a browser that cannot (Safari) never pays for decoding a card and
 * drawing it into a canvas only to be handed the PNG back.
 */
let encoderProbe: Promise<boolean> | null = null;
function canEncodeWebp(): Promise<boolean> {
  encoderProbe ??= (async () => {
    try {
      const probe = document.createElement("canvas");
      probe.width = probe.height = 1;
      const blob = await canvasToBlob(probe);
      return !!blob && (await isWebp(blob));
    } catch {
      return false;
    }
  })();
  return encoderProbe;
}

/**
 * The card as a WebP, or null when the PNG should go instead: no encoder, an
 * encode that failed or came back as something else, or one no smaller.
 */
export async function cardAsWebp(png: Blob): Promise<Blob | null> {
  if (!(await canEncodeWebp())) return null;
  try {
    const bitmap = await createImageBitmap(png);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const webp = await canvasToBlob(canvas);
    // Checked on EVERY card, not just the probe: the format is a promise the
    // server will hold us to, and a wrong guess is a 400 or a card that never
    // decodes.
    return webp && webp.size < png.size && (await isWebp(webp)) ? webp : null;
  } catch {
    return null;
  }
}

/** Set once a server that advertised WebP refused a WebP card. */
let webpRefused = false;

/**
 * POST a card to `url`: WebP when the server takes it and this browser makes
 * it, the PNG otherwise. Returns the response the caller should judge.
 */
export async function postCard(url: string, png: Blob, serverTakesWebp: boolean): Promise<Response> {
  const post = (body: Blob) =>
    fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    });
  const webp = serverTakesWebp && !webpRefused ? await cardAsWebp(png) : null;
  if (!webp) return post(png);
  const res = await post(webp);
  if (res.status !== 400) return res;
  // Refused as a bad picture: send what it always took. Only blame the format
  // if the PNG then goes through — a 400 for any other reason (an item that
  // takes no catalog card) would be a 400 for the PNG too.
  const retry = await post(png);
  if (retry.ok) webpRefused = true;
  return retry;
}
