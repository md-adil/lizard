// @serwist/turbopack doesn't emit a static public/sw.js via a webpack
// plugin (that's @serwist/next, which needs webpack — this app builds with
// Turbopack even for `next build`, see next.config.ts). Instead it bundles
// app/sw.ts with esbuild and serves the result — plus its sourcemap — through
// this catch-one-segment Route Handler, which only matches "/sw.js" and
// "/sw.js.map" (generateStaticParams below); dynamicParams: false 404s
// anything else instead of falling through to a route that doesn't exist.
import { randomUUID } from "node:crypto";
import { createSerwistRoute } from "@serwist/turbopack";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "app/sw.ts",
  // Native esbuild (a devDependency) over the default esbuild-wasm — faster,
  // and this app doesn't need the wasm build's portability.
  useNativeEsbuild: true,
  // A fresh id every build so the (otherwise-unhashed) offline fallback
  // route gets re-precached on each deploy instead of sticking forever.
  additionalPrecacheEntries: [{ url: "/~offline", revision: randomUUID() }],
});
