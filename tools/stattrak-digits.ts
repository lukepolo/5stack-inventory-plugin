// Does our StatTrak digit decode match Valve's shader?
//
// Run: node --experimental-strip-types tools/stattrak-digits.ts
//
// Why this exists
// ---------------
// The counter readout is the one part of the module with a provably right
// answer, and it is the part hardest to eyeball: a leading-zero bug renders
// "007" as "7" or "0000007" and both look plausible in a 3D viewer at card
// size. The decode is pure, so it can be checked here instead of by squinting.
//
// Reference is csgo_weapon_stattrak.vfx, which draws all six digits from one
// integer:
//
//   uint q  = uint(value) / div[slot];
//   idx.x   = int(q != 0 || slot == 5) + (q % 10)
//
// Atlas column 0 is BLANK, columns 1..10 are digits 0..9 — so a rendered digit
// d is column d+1, and this test reads column indices, not glyphs.
import { digitColumns, MAX_STATTRAK } from "../src/stattrakModule.ts";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL ${label}\n  got  ${g}\n  want ${w}`);
    failures++;
  } else {
    console.log(`ok   ${label}  ${g}`);
  }
}

/** Human-readable rendering. "_" is atlas column 0, which is the UNLIT zero
 *  glyph — NOT an empty cell. CS2 draws it, which is why a fresh StatTrak
 *  reads "000000" rather than a lone "0" on a dark plate. */
const show = (v: number | null) =>
  digitColumns(v)
    .map((c) => (c === 0 ? "_" : String(c - 1)))
    .join("");

// A dark display is the 2D card's whole reason for existing: the baked card
// must not encode a count, or it goes stale the moment a kill lands. Every
// slot falls back to the unlit glyph, so the plate reads as powered-off.
check("null = every cell unlit", digitColumns(null), [0, 0, 0, 0, 0, 0]);

// The ones place always renders, so zero kills reads "0" and not blank.
check("0 lights only the ones place", show(0), "_____0");
check("7", show(7), "_____7");
check("70", show(70), "____70");
check("1337", show(1337), "__1337");
check("999999 fills every slot", show(999999), "999999");

// Leading zeros INSIDE the number must still render — the trim rule keys off
// the running quotient, not off the digit, which is exactly the bit that a
// naive rewrite gets wrong.
check("1007 keeps interior zeros lit", show(1007), "__1007");
check("100000", show(100000), "100000");

// Clamping: the counter saturates rather than wrapping, and a wrapped value
// would render a wildly wrong readout instead of an obviously capped one.
check("above max clamps", show(MAX_STATTRAK + 1), "999999");
check("negative clamps to zero", show(-5), "_____0");
// Fractional counts cannot come from the DB, but can from a bad cast; floor
// rather than round, so 1.9 is never displayed as 2.
check("fractional floors", show(1.9), "_____1");

// Column indices are what actually index the atlas, so assert one directly
// rather than only through the display helper.
check("column indices for 42", digitColumns(42), [0, 0, 0, 0, 5, 3]);

check("always six slots", digitColumns(1234567).length, 6);

console.log(failures === 0 ? "\nall passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
