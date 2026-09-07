import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import { appUrl } from "@/lib/urls";

// Served at /sitemap.xml. Only public, indexable routes belong here — the API
// routes and /offline fallback are excluded (see robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/demo`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: appUrl().startsWith("http") ? appUrl() : `${SITE_URL}/app`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
