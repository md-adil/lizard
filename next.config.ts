import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pino loads its transport (pino-pretty) at runtime in a worker thread, so
  // it must stay outside the bundle.
  serverExternalPackages: ["@duckdb/node-api", "pg", "pino", "pino-pretty"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
