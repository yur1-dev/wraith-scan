import type { MetadataRoute } from "next";

// Makes WRAITH installable ("Add to Home Screen" / "Install app") on Android and iPhone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wraith",
    short_name: "Wraith",
    description: "Scan viral memes, find tokens, trade across chains.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0c0d",
    theme_color: "#0c0c0d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
