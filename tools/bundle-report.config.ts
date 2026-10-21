// What is inside a chunk, and why it is there. A build config that wraps the
// real one and, after bundling, prints the modules of the chunks you name, the
// biggest first, with each chunk's static imports (what loads WITH it) and its
// dynamic imports (what it can load later):
//
//   npx vite build --config tools/bundle-report.config.ts --outDir /tmp/inv-report
//   CHUNKS=App-,viewer3d- TOP=25 npx vite build --config tools/bundle-report.config.ts --outDir /tmp/inv-report
//
// Sizes are rendered (pre-minify) characters per module, so compare them with
// each other, not with the minified chunk sizes Vite prints. A module sits in
// exactly one chunk: one that BOTH the boot chunk and a lazy one import lands
// in a shared chunk the boot chunk imports statically, so it downloads at load
// however lazy its other importer is. That is how the paint, glove and charm
// pipelines ended up in front of first paint (docs/DEBUGGING.md §4.15).
import base from "../vite.config.ts";

declare const process: { env: Record<string, string | undefined> };

type Chunk = {
  type: string;
  fileName: string;
  code?: string;
  imports?: string[];
  dynamicImports?: string[];
  modules?: Record<string, { renderedLength: number }>;
};

const wanted = (process.env.CHUNKS ?? "App-").split(",");
const top = Number(process.env.TOP ?? 30);

export default {
  ...base,
  plugins: [
    ...(base as { plugins: unknown[] }).plugins,
    {
      name: "bundle-report",
      enforce: "post" as const,
      generateBundle(_opts: unknown, bundle: Record<string, Chunk>) {
        for (const c of Object.values(bundle)) {
          if (c.type !== "chunk" || !wanted.some((w) => c.fileName.includes(w))) continue;
          const mods = Object.entries(c.modules ?? {})
            .map(([id, m]) => ({ id: id.replace(/^.*\/node_modules\//, "npm:").replace(/^.*?\/src\//, "src/"), len: m.renderedLength }))
            .sort((a, b) => b.len - a.len);
          const lines = [
            `\n== ${c.fileName}  ${c.code?.length ?? 0} bytes, ${mods.length} modules`,
            `   loads with it: ${(c.imports ?? []).join(", ") || "-"}`,
            `   can load later: ${(c.dynamicImports ?? []).filter((d) => !/\/c\d{5}-/.test(d)).join(", ") || "-"}`,
            ...mods.slice(0, top).map((m) => `   ${String(m.len).padStart(8)}  ${m.id}`),
          ];
          console.log(lines.join("\n"));
        }
      },
    },
  ],
};
