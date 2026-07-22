import { describe, it, expect } from "vitest";
import { getDialect, getDriver } from "@/app/api/database/registry";
import { EngineNotSupportedError } from "@/app/api/database/driver";

describe("postgres dialect", () => {
  const pg = getDialect("postgres");

  it("quotes identifiers and escapes embedded quotes", () => {
    expect(pg.quoteIdent("users")).toBe('"users"');
    expect(pg.quoteIdent('we"ird')).toBe('"we""ird"');
  });

  it("uses $n positional placeholders", () => {
    expect(pg.placeholder(1)).toBe("$1");
    expect(pg.placeholder(7)).toBe("$7");
  });

  it("casts and builds case-insensitive predicates the PG way", () => {
    expect(pg.castToText('"c"')).toBe('"c"::text');
    expect(pg.cast('"c"', "int4")).toBe('"c"::int4');
    expect(pg.caseInsensitiveLike('"c"', "$1")).toBe('"c"::text ILIKE $1');
    expect(pg.regexMatch('"c"', "$1")).toBe('"c"::text ~* $1');
  });

  it("declares its capabilities", () => {
    expect(pg.supportsReturning).toBe(true);
    expect(pg.supportsArrays).toBe(true);
    expect(pg.supportsSchemas).toBe(true);
    expect(pg.beginReadOnly()).toEqual(["BEGIN TRANSACTION READ ONLY"]);
  });

  it("maps known SQLSTATE codes to friendly errors, null otherwise", () => {
    expect(pg.mapError({ code: "23505", detail: "Key (id)=(1) exists." })).toEqual({
      status: 409,
      message: "Duplicate value violates unique constraint: Key (id)=(1) exists.",
    });
    expect(pg.mapError({ code: "23502", column: "email" })).toEqual({
      status: 400,
      message: '"email" is required and cannot be empty',
    });
    expect(pg.mapError({ code: "99999" })).toBeNull();
  });
});

describe("mysql dialect", () => {
  const mysql = getDialect("mysql");

  it("quotes identifiers and escapes embedded backticks", () => {
    expect(mysql.quoteIdent("users")).toBe("`users`");
    expect(mysql.quoteIdent("we`ird")).toBe("`we``ird`");
  });

  it("uses ? positional placeholders", () => {
    expect(mysql.placeholder(1)).toBe("?");
    expect(mysql.placeholder(7)).toBe("?");
  });

  it("casts and builds case-insensitive predicates the MySQL way", () => {
    expect(mysql.castToText("`c`")).toBe("CAST(`c` AS CHAR)");
    expect(mysql.cast("`c`", "int4")).toBe("CAST(`c` AS SIGNED)");
    expect(mysql.caseInsensitiveLike("`c`", "?")).toBe("LOWER(CAST(`c` AS CHAR)) LIKE LOWER(?)");
    expect(mysql.regexMatch("`c`", "?")).toBe("CAST(`c` AS CHAR) REGEXP ?");
  });

  it("declares its capabilities", () => {
    expect(mysql.supportsReturning).toBe(false);
    expect(mysql.supportsArrays).toBe(false);
    expect(mysql.supportsSchemas).toBe(false);
    expect(mysql.beginReadOnly()).toEqual(["START TRANSACTION READ ONLY"]);
  });

  it("maps known MySQL error codes to friendly errors, null otherwise", () => {
    expect(mysql.mapError({ errno: 1062, message: "Duplicate entry '1' for key 'primary'" })).toEqual({
      status: 409,
      message: "Duplicate value violates unique constraint: Duplicate entry '1' for key 'primary'",
    });
    expect(mysql.mapError({ code: "ER_NO_REFERENCED_ROW_2", message: "Cannot add or update a child row" })).toEqual({
      status: 409,
      message: "Referenced row does not exist: Cannot add or update a child row",
    });
    expect(mysql.mapError({ errno: 1048, message: "Column 'email' cannot be null" })).toEqual({
      status: 400,
      message: "Value is required and cannot be empty: Column 'email' cannot be null",
    });
    expect(mysql.mapError({ errno: 9999 })).toBeNull();
  });
});

describe("engine registry", () => {
  it("resolves dialect and driver for postgres and mysql", () => {
    expect(getDialect("postgres")).toBeDefined();
    expect(getDialect("mysql")).toBeDefined();
    expect(getDriver("postgres")).toBeDefined();
    expect(getDriver("mysql")).toBeDefined();
  });

  it("resolves a driver for mongo (document store) with a null dialect", () => {
    // Mongo has a Driver (introspect + data builder) but no relational SQL
    // dialect, so getDriver resolves while getDialect still refuses it.
    const driver = getDriver("mongo");
    expect(driver).toBeDefined();
    expect(driver.dialect).toBeNull();
    expect(() => getDialect("mongo")).toThrow(EngineNotSupportedError);
  });
});
