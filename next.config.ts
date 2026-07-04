import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@duckdb/node-api", "pg"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
