import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its font files from node_modules at runtime, so it must not be bundled.
  serverExternalPackages: ["pdfkit"],
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default nextConfig;
