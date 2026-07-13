import type { Dialect, MappedError } from "@/app/api/database/driver";

export const mysqlDialect: Dialect = {
  engine: "mysql",

  quoteIdent(name) {
    return `\`${name.replace(/`/g, "``")}\``;
  },

  placeholder(i) {
    return "?";
  },

  castToText(expr) {
    return `CAST(${expr} AS CHAR)`;
  },

  cast(expr, type) {
    const t = type.toLowerCase();
    let mysqlType = type;
    if (t.includes("int") || t === "bool") {
      mysqlType = "SIGNED";
    } else if (t === "numeric" || t === "decimal" || t === "float4" || t === "float8" || t === "real" || t === "double") {
      mysqlType = "DECIMAL";
    } else if (t === "timestamp" || t === "timestamptz" || t === "datetime") {
      mysqlType = "DATETIME";
    } else if (t === "date") {
      mysqlType = "DATE";
    } else if (t === "varchar" || t === "text" || t === "char" || t === "uuid") {
      mysqlType = "CHAR";
    } else if (t === "json" || t === "jsonb") {
      mysqlType = "JSON";
    }
    return `CAST(${expr} AS ${mysqlType})`;
  },

  caseInsensitiveLike(expr, placeholder) {
    return `LOWER(CAST(${expr} AS CHAR)) LIKE LOWER(${placeholder})`;
  },

  regexMatch(expr, placeholder) {
    return `CAST(${expr} AS CHAR) REGEXP ${placeholder}`;
  },

  dateTrunc(expr) {
    return `DATE(${expr})`;
  },

  likeEscapeChar: "\\",

  supportsReturning: false,
  supportsArrays: false,
  supportsSchemas: false,

  beginReadOnly() {
    return ["START TRANSACTION READ ONLY"];
  },

  mapError(e): MappedError | null {
    const err = e as {
      code?: string;
      errno?: number;
      sqlState?: string;
      message?: string;
    };
    const code = err.code || "";
    const errno = err.errno;
    const message = err.message || "";

    // Duplicate entry
    if (code === "ER_DUP_ENTRY" || errno === 1062) {
      return {
        status: 409,
        message: `Duplicate value violates unique constraint: ${message}`,
      };
    }
    // Foreign key constraint fails
    if (code === "ER_NO_REFERENCED_ROW_2" || errno === 1452 || code === "ER_NO_REFERENCED_ROW" || errno === 1216) {
      return {
        status: 409,
        message: `Referenced row does not exist: ${message}`,
      };
    }
    if (code === "ER_ROW_IS_REFERENCED_2" || errno === 1451 || code === "ER_ROW_IS_REFERENCED" || errno === 1217) {
      return {
        status: 409,
        message: `Cannot delete or update parent row due to foreign key constraint: ${message}`,
      };
    }
    // Column cannot be null
    if (code === "ER_BAD_NULL_ERROR" || errno === 1048) {
      return {
        status: 400,
        message: `Value is required and cannot be empty: ${message}`,
      };
    }
    // Check constraint violated
    if (code === "ER_CHECK_CONSTRAINT_VIOLATED" || errno === 3819) {
      return {
        status: 400,
        message: `Value violates check constraint: ${message}`,
      };
    }
    // Incorrect value format / data truncation
    if (
      code === "ER_TRUNCATED_WRONG_VALUE" || errno === 1292 ||
      code === "ER_WARN_DATA_OUT_OF_RANGE" || errno === 1264 ||
      code === "ER_DATA_TOO_LONG" || errno === 1406
    ) {
      return {
        status: 400,
        message: `Invalid value format: ${message}`,
      };
    }
    // Access denied / permission error
    if (
      code === "ER_DBACCESS_DENIED_ERROR" || errno === 1044 ||
      code === "ER_TABLEACCESS_DENIED_ERROR" || errno === 1142
    ) {
      return {
        status: 403,
        message: "The database role lacks permission for this operation",
      };
    }
    return null;
  },
};
