import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page here is per-user financial data that must always be fresh, so
  // Cache Components / prefetching are left off on purpose.
  // PGlite ships WebAssembly and data files; load it from node_modules as-is.
  serverExternalPackages: ["@electric-sql/pglite", "pdfkit"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
