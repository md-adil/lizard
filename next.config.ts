import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pino loads its transport (pino-pretty) at runtime in a worker thread, so
  // it must stay outside the bundle.
  serverExternalPackages: ["@duckdb/node-api", "pg", "pino", "pino-pretty"],
  // @duckdb/node-bindings picks its native addon via a runtime require()
  // branch (glibc/musl x64/arm64 detection) — the standalone output's file
  // tracer only follows static import/require graphs, so it can't see which
  // branch actually fires and leaves libduckdb.so out of
  // .next/standalone/node_modules entirely ("cannot open shared object
  // file" at runtime, e.g. in Docker). Force-including every Linux variant
  // is harmless: whichever one doesn't match the build platform just isn't
  // present in node_modules, so its glob matches nothing.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/@duckdb/node-bindings-linux-x64/**",
      "./node_modules/@duckdb/node-bindings-linux-x64-musl/**",
      "./node_modules/@duckdb/node-bindings-linux-arm64/**",
      "./node_modules/@duckdb/node-bindings-linux-arm64-musl/**",
    ],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
