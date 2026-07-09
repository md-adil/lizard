"use client";

// Inline preview for image/video/audio widgets — the column stores a URL
// (or data: URI), rendered with the matching native media element.
export type MediaKind = "image" | "video" | "audio";

export function MediaPreview({ kind, value, className }: { kind: MediaKind; value: string; className?: string }) {
  if (!value) return null;
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={value}
        alt=""
        className={className ?? "max-h-40 rounded border object-contain"}
        style={{ borderColor: "var(--input)", background: "var(--muted)" }}
      />
    );
  }
  if (kind === "video") {
    return (
      <video
        src={value}
        controls
        className={className ?? "max-h-40 rounded border"}
        style={{ borderColor: "var(--input)" }}
      />
    );
  }
  return <audio src={value} controls className={className ?? "w-full"} style={{ height: 32 }} />;
}
