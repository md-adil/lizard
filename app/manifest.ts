import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lizard",
    short_name: "Lizard",
    description: "AI-native data console for your Postgres fleet",
    start_url: "/",
    display: "standalone",
    background_color: "#f1f5f9",
    theme_color: "#7c3aed",
    icons: [
      { src: "/icon-128.png", sizes: "128x128", type: "image/png" },
      { src: "/icon-256.png", sizes: "256x256", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
