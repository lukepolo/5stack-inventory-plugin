// Does every .vue file actually PARSE?
//
// `vue-tsc --noEmit` does not answer that. It recovered silently from an
// orphaned `</template>` left behind by a template edit, reported nothing, and
// the next `vite build` died with "Element is missing end tag" — a class of
// break that typechecking is structurally blind to and that costs a full build
// cycle to discover.
//
// Run: node tools/sfc-parse-check.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@vue/compiler-sfc";

function vueFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(path).isDirectory()) return vueFiles(path);
    return name.endsWith(".vue") ? [path] : [];
  });
}

let failures = 0;
for (const file of vueFiles("src")) {
  const { errors } = parse(readFileSync(file, "utf8"), { filename: file });
  for (const error of errors) {
    failures++;
    console.log(`  FAIL  ${file}:${error.loc?.start.line ?? "?"} — ${error.message}`);
  }
}
console.log(failures === 0 ? "All SFCs parse." : `\n${failures} template error(s).`);
process.exit(failures === 0 ? 0 : 1);
