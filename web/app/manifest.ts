import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ascend",
    short_name: "Ascend",
    description: "Point-of-sale and business management platform",
    start_url: "/terminal",
    display: "standalone",
    background_color: "#F9F9F9",
    theme_color: "#5D5FEF",
    orientation: "any",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    screenshots: [],
    categories: ["business", "finance", "productivity"],
    shortcuts: [
      {
        name: "New Sale",
        short_name: "Sale",
        url: "/terminal",
        description: "Open the POS terminal",
      },
      {
        name: "Orders",
        short_name: "Orders",
        url: "/orders",
        description: "View recent orders",
      },
    ],
  };
}
