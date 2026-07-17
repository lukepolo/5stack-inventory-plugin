import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pool } from "./db.ts";

const schema = readFileSync(
  fileURLToPath(new URL("./schema.sql", import.meta.url)),
  "utf8",
);

await pool.query(schema);
console.log("inventory schema applied");
await pool.end();
