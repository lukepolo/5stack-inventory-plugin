import pg from "pg";

// DATABASE_URL can be any Postgres the connecting role may create a schema in —
// including the shared cluster Postgres. The plugin owns an `inventory` schema
// and schema-qualifies every query, so it never touches 5stack's tables and
// needs no separate database.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
