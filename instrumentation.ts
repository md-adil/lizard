// Next.js instrumentation hook — runs once when the server process boots,
// before any request is handled. Used to apply metadata store migrations
// up front instead of lazily on the first call to getDb().
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initMetadataDb } = await import("@/lib/metadata/store");
    initMetadataDb();
  }
}
