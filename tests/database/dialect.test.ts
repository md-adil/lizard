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

describe("engine registry", () => {
  it("throws EngineNotSupportedError for engines without a dialect/driver yet", () => {
    expect(() => getDialect("mysql")).toThrow(EngineNotSupportedError);
    expect(() => getDialect("mongo")).toThrow(EngineNotSupportedError);
    expect(() => getDriver("postgres")).toThrow(EngineNotSupportedError);
  });
});
