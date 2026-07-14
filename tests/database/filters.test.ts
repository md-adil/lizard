import { describe, it, expect } from "vitest";
import { buildFilterClause } from "@/lib/data/filters";
import { buildMatchClause } from "@/lib/data/search-match";
import { mysqlDialect } from "@/app/api/database/mysql/dialect";
import { postgresDialect } from "@/app/api/database/postgres/dialect";
import type { TableInfo } from "@/lib/types";

const col = (name: string, udtName: string) => ({
  name,
  udtName,
  nullable: false,
  maxLength: null,
  isPrimaryKey: false,
  defaultValue: null,
});

const table = {
  name: "user_milestone_progresses",
  schema: "activity",
  columns: [col("milestone_id", "varchar"), col("note", "text"), col("status", "enum"), col("score", "int4")],
} as unknown as TableInfo;

const clause = (column: string, op: string, extra: Record<string, unknown>, dialect = mysqlDialect) =>
  buildFilterClause(table, [{ column, op, ...extra }] as never[], "and", dialect);

// A cast result carries the *connection's* collation with implicit
// coercibility, so MySQL refuses to compare it against an implicitly-collated
// column of any other collation ("illegal mix of collations" — every
// utf8mb4_unicode_ci column on a MySQL 8 server, whose connection default is
// utf8mb4_0900_ai_ci). A bare parameter is merely coercible and adopts the
// column's own collation, so text comparisons must never wrap the parameter.
describe("text filters bind bare, never through a cast", () => {
  it("binds an equality parameter against a varchar column without casting it", () => {
    const { clause: sql, values } = clause("milestone_id", "eq", { value: "abc" });
    expect(sql).toBe("(`milestone_id` = ?)");
    expect(values).toEqual(["abc"]);
  });

  it("binds text and enum columns bare too (CAST(? AS enum) is not even legal MySQL)", () => {
    expect(clause("note", "eq", { value: "hi" }).clause).toBe("(`note` = ?)");
    expect(clause("status", "eq", { value: "done" }).clause).toBe("(`status` = ?)");
  });

  it("binds every element of an IN list bare", () => {
    const { clause: sql, values } = clause("milestone_id", "in", { values: ["a", "b"] });
    expect(sql).toBe("(`milestone_id` IN (?, ?))");
    expect(values).toEqual(["a", "b"]);
  });

  it("binds an exact global-search term bare", () => {
    const values: unknown[] = [];
    const sql = buildMatchClause(
      { table, columns: [{ col: col("milestone_id", "varchar"), mode: "exact" }] } as never,
      "abc",
      values,
      mysqlDialect,
    );
    expect(sql).toBe("(`milestone_id` = ?)");
    expect(values).toEqual(["abc"]);
  });

  it("still casts a string bound against a non-text column", () => {
    expect(clause("score", "eq", { value: "5" }).clause).toBe("(`score` = CAST(CAST(? AS CHAR) AS SIGNED))");
  });

  it("still binds a number natively against a numeric column", () => {
    expect(clause("score", "eq", { value: 5 }).clause).toBe("(`score` = ?)");
  });

  it("leaves the postgres text path uncast as well", () => {
    expect(clause("milestone_id", "eq", { value: "abc" }, postgresDialect).clause).toBe('("milestone_id" = $1)');
  });
});
